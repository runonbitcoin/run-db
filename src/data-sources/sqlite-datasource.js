/**
 * database.js
 *
 * Layer between the database and the application
 */
const Sqlite3Database = require('better-sqlite3')
const { HEIGHT_MEMPOOL } = require('../constants')
const fastq = require('fastq')

// The + in the following 2 queries before downloaded improves performance by NOT using the
// tx_downloaded index, which is rarely an improvement over a simple filter for single txns.
// See: https://www.sqlite.org/optoverview.html
const TRUSTED_AND_READY_TO_EXECUTE_SQL = `
      SELECT (
        downloaded = 1
        AND executable = 1
        AND executed = 0
        AND (has_code = 0 OR (SELECT COUNT(*) FROM trust WHERE trust.txid = tx.txid AND trust.value = 1) = 1)
        AND txid NOT IN ban
        AND (
          SELECT COUNT(*)
          FROM tx AS tx2
          JOIN deps
          ON deps.up = tx2.txid
          WHERE deps.down = tx.txid
          AND (+tx2.downloaded = 0 OR (tx2.executable = 1 AND tx2.executed = 0))
        ) = 0
      ) AS ready 
      FROM tx
      WHERE txid = ?
    `

const READY_TO_EXECUTE_SQL = `
      SELECT (
              downloaded = 1
              AND executable = 1
              AND executed = 0
              AND (
                SELECT COUNT(*)
                FROM tx AS tx2
                JOIN deps
                ON deps.up = tx2.txid
                WHERE deps.down = tx.txid AND 
                (
                  +tx2.downloaded = 0 OR
                  (tx2.executable = 1 AND tx2.executed = 0) OR
                  (tx2.executed = 1 AND tx2.indexed = 0)
                )
              ) = 0
            ) AS ready 
            FROM tx
            WHERE txid = ?
`

const GET_DOWNSTREAM_READY_TO_EXECUTE_SQL = `
      SELECT down
      FROM deps
      JOIN tx
      ON tx.txid = deps.down
      WHERE up = ?
      AND +downloaded = 1
      AND executable = 1
      AND executed = 0
      AND (has_code = 0 OR (SELECT COUNT(*) FROM trust WHERE trust.txid = tx.txid AND trust.value = 1) = 1)
      AND txid NOT IN ban
      AND (
        SELECT COUNT(*)
        FROM tx AS tx2
        JOIN deps
        ON deps.up = tx2.txid
        WHERE deps.down = tx.txid
        AND (+tx2.downloaded = 0 OR (tx2.executable = 1 AND tx2.executed = 0))
      ) = 0
    `

// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------

class SqliteDatasource {
  constructor (path, logger, readonly = false) {
    this.path = path
    this.logger = logger
    this.readonly = readonly
    this.connection = null

    const worker = async (fn, cb) => {
      try {
        this.connection.exec('begin;')
        const result = await fn()
        this.connection.exec('commit;')
        cb(result)
      } catch (e) {
        this.connection.exec('rollback;')
        console.error(e)
        throw e
      }
    }

    this.txQueue = fastq(worker, 1)
  }

  async migrateSchema () {
    await this.initializeV1()
    await this.initializeV2()
    await this.initializeV3()
    await this.initializeV4()
    await this.initializeV5()
    await this.initializeV6()
    await this.initializeV7()
  }

  prepareStatements () {
    // this.addNewTransactionStmt = this.connection.prepare('INSERT OR IGNORE INTO tx (txid, height, time, bytes, has_code, executable, executed, indexed) VALUES (?, null, ?, null, 0, 0, 0, 0)''INSERT OR IGNORE INTO tx (txid, height, time, bytes, has_code, executable, executed, indexed) VALUES (?, null, ?, null, 0, 0, 0, 0)')
    this.setTransactionBytesStmt = this.connection.prepare('UPDATE tx SET bytes = ? WHERE txid = ?')
    this.setTransactionExecutableStmt = this.connection.prepare('UPDATE tx SET executable = ? WHERE txid = ?')
    this.setTransactionTimeStmt = this.connection.prepare('UPDATE tx SET time = ? WHERE txid = ?')
    this.setTransactionHeightStmt = this.connection.prepare(`UPDATE tx SET height = ? WHERE txid = ? AND (height IS NULL OR height = ${HEIGHT_MEMPOOL})`)
    this.setTransactionHasCodeStmt = this.connection.prepare('UPDATE tx SET has_code = ? WHERE txid = ?')
    this.setTransactionExecutedStmt = this.connection.prepare('UPDATE tx SET executed = ? WHERE txid = ?')
    this.setTransactionIndexedStmt = this.connection.prepare('UPDATE tx SET indexed = ? WHERE txid = ?')
    this.txExistsStmt = this.connection.prepare('SELECT txid FROM tx WHERE txid = ?')
    this.getTransactionHexStmt = this.connection.prepare('SELECT LOWER(HEX(bytes)) AS hex FROM tx WHERE txid = ?')
    this.getTransactionTimeStmt = this.connection.prepare('SELECT time FROM tx WHERE txid = ?')
    this.getTransactionHeightStmt = this.connection.prepare('SELECT height FROM tx WHERE txid = ?')
    this.getTransactionHasCodeStmt = this.connection.prepare('SELECT has_code FROM tx WHERE txid = ?')
    this.getTransactionIndexedStmt = this.connection.prepare('SELECT indexed FROM tx WHERE txid = ?')
    this.getTransactionWasExecutedStmt = this.connection.prepare('SELECT executed FROM tx WHERE txid = ?')
    this.getTransactionFailedStmt = this.connection.prepare('SELECT (executed = 1 AND indexed = 0) AS failed FROM tx WHERE txid = ?')
    this.getTransactionDownloadedStmt = this.connection.prepare('SELECT downloaded FROM tx WHERE txid = ?')
    this.deleteTransactionStmt = this.connection.prepare('DELETE FROM tx WHERE txid = ?')
    this.unconfirmTransactionStmt = this.connection.prepare(`UPDATE tx SET height = ${HEIGHT_MEMPOOL} WHERE txid = ?`)
    this.getTransactionsAboveHeightStmt = this.connection.prepare('SELECT txid FROM tx WHERE height > ?')
    this.getMempoolTransactionsBeforeTimeStmt = this.connection.prepare(`SELECT txid FROM tx WHERE height = ${HEIGHT_MEMPOOL} AND time < ?`)
    this.getTransactionsToDownloadStmt = this.connection.prepare('SELECT txid FROM tx WHERE downloaded = 0')
    this.getTransactionsDownloadedCountStmt = this.connection.prepare('SELECT COUNT(*) AS count FROM tx WHERE downloaded = 1')
    this.getTransactionsIndexedCountStmt = this.connection.prepare('SELECT COUNT(*) AS count FROM tx WHERE indexed = 1')
    this.isTrustedAndReadyToExecuteStmt = this.connection.prepare(TRUSTED_AND_READY_TO_EXECUTE_SQL)
    this.isReadyToExecuteStmt = this.connection.prepare(READY_TO_EXECUTE_SQL)
    this.depsExecutedOkStmt = this.connection.prepare(`
        SELECT COUNT(*) = 0 as ok
        FROM tx
        JOIN deps ON deps.up = tx.txid
        WHERE deps.down = ?
        AND (+tx.downloaded = 0 OR (tx.executable = 1 AND tx.executed = 0))
    `)
    this.getDownstreamReadyToExecuteStmt = this.connection.prepare(GET_DOWNSTREAM_READY_TO_EXECUTE_SQL)
    this.getTxMetadataStmt = this.connection.prepare('SELECT * FROM tx WHERE txid = ?')

    this.setSpendStmt = this.connection.prepare('INSERT OR REPLACE INTO spends (location, spend_txid) VALUES (?, ?)')
    this.setUnspentStmt = this.connection.prepare('INSERT OR IGNORE INTO spends (location, spend_txid) VALUES (?, null)')
    this.getSpendStmt = this.connection.prepare('SELECT spend_txid FROM spends WHERE location = ?')
    this.unspendOutputsStmt = this.connection.prepare('UPDATE spends SET spend_txid = null WHERE spend_txid = ?')
    this.deleteSpendsStmt = this.connection.prepare('DELETE FROM spends WHERE location LIKE ? || \'%\'')
    //
    this.addDepStmt = this.connection.prepare('INSERT OR IGNORE INTO deps (up, down) VALUES (?, ?)')
    this.deleteDepsStmt = this.connection.prepare('DELETE FROM deps WHERE down = ?')
    this.getDownstreamStmt = this.connection.prepare('SELECT down FROM deps WHERE up = ?')
    this.getUpstreamUnexecutedCodeStmt = this.connection.prepare(`
      SELECT txdeps.txid as txid
      FROM (SELECT up AS txid FROM deps WHERE down = ?) as txdeps
      JOIN tx ON tx.txid = txdeps.txid
      WHERE tx.executable = 1 AND tx.executed = 0 AND tx.has_code = 1
    `)
    this.hasFailedDepStmt = this.connection.prepare(`
      SELECT count(*) > 0 FROM tx
      JOIN deps ON deps.up = tx.txid
      WHERE
          tx.txid = ? AND
          tx.executed = 1 AND
          tx.indexed = 0;
    `)
    //
    this.setJigStateStmt = this.connection.prepare('INSERT OR IGNORE INTO jig (location, state, class, lock, scripthash) VALUES (?, ?, null, null, null)')
    this.setJigMetadataStmt = this.connection.prepare('INSERT OR IGNORE INTO jig (location)  VALUES (?)')
    this.setJigClassStmt = this.connection.prepare('UPDATE jig SET class = ? WHERE location = ?')
    this.setJigLockStmt = this.connection.prepare('UPDATE jig SET lock = ? WHERE location = ?')
    this.setJigScripthashStmt = this.connection.prepare('UPDATE jig SET scripthash = ? WHERE location = ?')
    this.getJigStateStmt = this.connection.prepare('SELECT state FROM jig WHERE location = ?')
    this.deleteJigStatesStmt = this.connection.prepare('DELETE FROM jig WHERE location LIKE ? || \'%\'')

    const getAllUnspentSql = `
      SELECT spends.location AS location FROM spends
      JOIN jig ON spends.location = jig.location
      WHERE spends.spend_txid IS NULL`
    this.getAllUnspentStmt = this.connection.prepare(getAllUnspentSql)
    this.getAllUnspentByClassStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.class = ?`)
    this.getAllUnspentByLockStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.lock = ?`)
    this.getAllUnspentByScripthashStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.scripthash = ?`)
    this.getAllUnspentByClassLockStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.class = ? AND lock = ?`)
    this.getAllUnspentByClassScripthashStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.class = ? AND scripthash = ?`)
    this.getAllUnspentByLockScripthashStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.lock = ? AND scripthash = ?`)
    this.getAllUnspentByClassLockScripthashStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.class = ? AND jig.lock = ? AND scripthash = ?`)
    this.getNumUnspentStmt = this.connection.prepare('SELECT COUNT(*) as unspent FROM spends JOIN jig ON spends.location = jig.location WHERE spends.spend_txid IS NULL')

    this.setBerryStateStmt = this.connection.prepare('INSERT OR IGNORE INTO berry (location, state) VALUES (?, ?)')
    this.setBerryMetadataStmt = this.connection.prepare('INSERT OR IGNORE INTO berry (location) VALUES (?)')
    this.getBerryStateStmt = this.connection.prepare('SELECT state FROM berry WHERE location = ?')
    this.deleteBerryStatesStmt = this.connection.prepare('DELETE FROM berry WHERE location LIKE ? || \'%\'')

    this.setTrustedStmt = this.connection.prepare('INSERT OR REPLACE INTO trust (txid, value) VALUES (?, ?)')
    this.getTrustlistStmt = this.connection.prepare('SELECT txid FROM trust WHERE value = 1')
    this.isTrustedStmt = this.connection.prepare('SELECT COUNT(*) FROM trust WHERE txid = ? AND value = 1')

    this.banStmt = this.connection.prepare('INSERT OR REPLACE INTO ban (txid) VALUES (?)')
    this.unbanStmt = this.connection.prepare('DELETE FROM ban WHERE txid = ?')
    this.isBannedStmt = this.connection.prepare('SELECT COUNT(*) FROM ban WHERE txid = ?')
    this.getBanlistStmt = this.connection.prepare('SELECT txid FROM ban')

    this.getHeightStmt = this.connection.prepare('SELECT value FROM crawl WHERE key = \'height\'')
    this.getHashStmt = this.connection.prepare('SELECT value FROM crawl WHERE key = \'hash\'')
    this.setHeightStmt = this.connection.prepare('UPDATE crawl SET value = ? WHERE key = \'height\'')
    this.setHashStmt = this.connection.prepare('UPDATE crawl SET value = ? WHERE key = \'hash\'')

    this.markExecutingStmt = this.connection.prepare('INSERT OR IGNORE INTO executing (txid) VALUES (?)')
    this.unmarkExecutingStmt = this.connection.prepare('DELETE FROM executing WHERE txid = ?')
    this.findAllExecutingTxidsStmt = this.connection.prepare('SELECT txid FROM executing')
  }

  async setUp () {
    this.logger.debug('Opening' + (this.readonly ? ' readonly' : '') + ' database')
    if (this.connection) throw new Error('Database already open')

    this.connection = new Sqlite3Database(this.path, { readonly: this.readonly })

    // 100MB cache
    this.connection.pragma('cache_size = 6400')
    this.connection.pragma('page_size = 16384')

    // WAL mode allows simultaneous readers
    this.connection.pragma('journal_mode = WAL')

    // Synchronizes WAL at checkpoints
    this.connection.pragma('synchronous = NORMAL')

    if (!this.readonly) {
      await this.migrateSchema()
    }

    this.prepareStatements()
  }

  async initializeV1 () {
    if (this.connection.pragma('user_version')[0].user_version !== 0) return

    this.logger.info('Setting up database v1')

    await this.performOnTransaction(() => {
      this.connection.pragma('user_version = 1')

      this.connection.prepare(
        `CREATE TABLE IF NOT EXISTS tx (
          txid TEXT NOT NULL,
          height INTEGER,
          time INTEGER,
          hex TEXT,
          has_code INTEGER,
          executable INTEGER,
          executed INTEGER,
          indexed INTEGER,
          UNIQUE(txid)
        )`
      ).run()

      this.connection.prepare(
        `CREATE TABLE IF NOT EXISTS spends (
          location TEXT NOT NULL PRIMARY KEY,
          spend_txid TEXT
        ) WITHOUT ROWID`
      ).run()

      this.connection.prepare(
        `CREATE TABLE IF NOT EXISTS deps (
          up TEXT NOT NULL,
          down TEXT NOT NULL,
          UNIQUE(up, down)
        )`
      ).run()

      this.connection.prepare(
        `CREATE TABLE IF NOT EXISTS jig (
          location TEXT NOT NULL PRIMARY KEY,
          state TEXT NOT NULL,
          class TEXT,
          scripthash TEXT,
          lock TEXT
        ) WITHOUT ROWID`
      ).run()

      this.connection.prepare(
        `CREATE TABLE IF NOT EXISTS berry (
          location TEXT NOT NULL PRIMARY KEY,
          state TEXT NOT NULL
        ) WITHOUT ROWID`
      ).run()

      this.connection.prepare(
        `CREATE TABLE IF NOT EXISTS trust (
          txid TEXT NOT NULL PRIMARY KEY,
          value INTEGER
        ) WITHOUT ROWID`
      ).run()

      this.connection.prepare(
        `CREATE TABLE IF NOT EXISTS ban (
          txid TEXT NOT NULL PRIMARY KEY
        ) WITHOUT ROWID`
      ).run()

      this.connection.prepare(
        `CREATE TABLE IF NOT EXISTS crawl (
          role TEXT UNIQUE,
          height INTEGER,
          hash TEXT
        )`
      ).run()

      this.connection.prepare(
        'CREATE INDEX IF NOT EXISTS tx_txid_index ON tx (txid)'
      ).run()

      this.connection.prepare(
        'CREATE INDEX IF NOT EXISTS jig_index ON jig (class)'
      ).run()

      this.connection.prepare(
        'INSERT OR IGNORE INTO crawl (role, height, hash) VALUES (\'tip\', 0, NULL)'
      ).run()
    })
  }

  async initializeV2 () {
    if (this.connection.pragma('user_version')[0].user_version !== 1) return

    this.logger.info('Setting up database v2')

    await this.performOnTransaction(() => {
      this.connection.pragma('user_version = 2')

      this.connection.prepare(
        `CREATE TABLE tx_v2 (
          txid TEXT NOT NULL,
          height INTEGER,
          time INTEGER,
          bytes BLOB,
          has_code INTEGER,
          executable INTEGER,
          executed INTEGER,
          indexed INTEGER
        )`
      ).run()

      const txids = this.connection.prepare('SELECT txid FROM tx').all().map(row => row.txid)
      const gettx = this.connection.prepare('SELECT * FROM tx WHERE txid = ?')
      const insert = this.connection.prepare('INSERT INTO tx_v2 (txid, height, time, bytes, has_code, executable, executed, indexed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')

      this.logger.info('Migrating data')
      for (const txid of txids) {
        const row = gettx.get(txid)
        const bytes = row.hex ? Buffer.from(row.hex, 'hex') : null
        insert.run(row.txid, row.height, row.time, bytes, row.has_code, row.executable, row.executed, row.indexed)
      }

      this.connection.prepare(
        'DROP INDEX tx_txid_index'
      ).run()

      this.connection.prepare(
        'DROP TABLE tx'
      ).run()

      this.connection.prepare(
        'ALTER TABLE tx_v2 RENAME TO tx'
      ).run()

      this.connection.prepare(
        'CREATE INDEX IF NOT EXISTS tx_txid_index ON tx (txid)'
      ).run()

      this.logger.info('Saving results')
    })

    this.logger.info('Optimizing database')
    this.connection.prepare('VACUUM').run()
  }

  async initializeV3 () {
    if (this.connection.pragma('user_version')[0].user_version !== 2) return

    this.logger.info('Setting up database v3')

    await this.performOnTransaction(() => {
      this.connection.pragma('user_version = 3')

      this.connection.prepare('CREATE INDEX IF NOT EXISTS deps_up_index ON deps (up)').run()
      this.connection.prepare('CREATE INDEX IF NOT EXISTS deps_down_index ON deps (down)').run()
      this.connection.prepare('CREATE INDEX IF NOT EXISTS trust_txid_index ON trust (txid)').run()

      this.logger.info('Saving results')
    })
  }

  async initializeV4 () {
    if (this.connection.pragma('user_version')[0].user_version !== 3) return

    this.logger.info('Setting up database v4')

    await this.performOnTransaction(() => {
      this.connection.pragma('user_version = 4')
      this.connection.prepare('ALTER TABLE tx ADD COLUMN downloaded INTEGER GENERATED ALWAYS AS (bytes IS NOT NULL) VIRTUAL').run()

      this.connection.prepare('CREATE INDEX IF NOT EXISTS tx_downloaded_index ON tx (downloaded)').run()

      this.logger.info('Saving results')
    })
  }

  async initializeV5 () {
    if (this.connection.pragma('user_version')[0].user_version !== 4) return

    this.logger.info('Setting up database v5')

    await this.performOnTransaction(() => {
      this.connection.pragma('user_version = 5')

      this.connection.prepare('CREATE INDEX IF NOT EXISTS ban_txid_index ON ban (txid)').run()
      this.connection.prepare('CREATE INDEX IF NOT EXISTS tx_height_index ON tx (height)').run()

      this.logger.info('Saving results')
    })
  }

  async initializeV6 () {
    if (this.connection.pragma('user_version')[0].user_version !== 5) return

    this.logger.info('Setting up database v6')

    await this.performOnTransaction(() => {
      this.connection.pragma('user_version = 6')

      const height = this.connection.prepare('SELECT height FROM crawl WHERE role = \'tip\'').raw(true).all()[0]
      const hash = this.connection.prepare('SELECT hash FROM crawl WHERE role = \'tip\'').raw(true).all()[0]

      this.connection.prepare('DROP TABLE crawl').run()

      this.connection.prepare(
        `CREATE TABLE IF NOT EXISTS crawl (
          key TEXT UNIQUE,
          value TEXT
        )`
      ).run()

      this.connection.prepare('INSERT INTO crawl (key, value) VALUES (\'height\', ?)').run(height.toString())
      this.connection.prepare('INSERT INTO crawl (key, value) VALUES (\'hash\', ?)').run(hash)

      this.logger.info('Saving results')
    })
  }

  async initializeV7 () {
    if (this.connection.pragma('user_version')[0].user_version !== 6) return

    this.logger.info('Setting up database v7')

    await this.performOnTransaction(() => {
      this.connection.pragma('user_version = 7')

      this.logger.info('Getting possible transactions to execute')
      const stmt = this.connection.prepare(`
          SELECT txid
          FROM tx 
          WHERE downloaded = 1
          AND executable = 1
          AND executed = 0
          AND (has_code = 0 OR (SELECT COUNT(*) FROM trust WHERE trust.txid = tx.txid AND trust.value = 1) = 1)
          AND txid NOT IN ban
        `)
      const txids = stmt.raw(true).all().map(x => x[0])

      const isReadyToExecuteStmt = this.connection.prepare(TRUSTED_AND_READY_TO_EXECUTE_SQL)

      const ready = []
      for (let i = 0; i < txids.length; i++) {
        const txid = txids[i]
        const row = isReadyToExecuteStmt.get(txid)
        if (row && row.ready) ready.push(txid)
        if (i % 1000 === 0) console.log('Checking to execute', i, 'of', txids.length)
      }

      this.logger.info('Marking', ready.length, 'transactions to execute')
      this.connection.prepare('CREATE TABLE IF NOT EXISTS executing (txid TEXT UNIQUE)').run()
      const markExecutingStmt = this.connection.prepare('INSERT OR IGNORE INTO executing (txid) VALUES (?)')
      ready.forEach(txid => markExecutingStmt.run(txid))

      this.logger.info('Saving results')
    })
  }

  async tearDown () {
    if (this.connection) {
      this.logger.debug('Closing' + (this.readonly ? ' readonly' : '') + ' database')
      this.connection.close()
      this.connection = null
    }
  }

  async performOnTransaction (fn) {
    if (!this.connection) return
    return new Promise((resolve, reject) => {
      this.txQueue.push(fn, (err, result) => {
        if (err) {
          reject(err)
        } else {
          resolve(result)
        }
      })
    })
    // if (!this.connection) return
    // try {
    //   this.connection.exec('begin;')
    //   await fn()
    //   this.connection.exec('commit;')
    // } catch (e) {
    //   this.connection.exec('rollback;')
    //   console.error(e)
    //   throw e
    // }
  }

  async txExists (txid) {
    return !!this.txExistsStmt.get(txid)
  }

  async checkTxIsDownloaded (txid) {
    const result = this.getTransactionDownloadedStmt.raw(true).get(txid)
    return result ? !!result[0] : false
  }

  async searchTxsAboveHeight (height) {
    return this.getTransactionsAboveHeightStmt.raw(true).all(height)
  }

  async mempoolTxsPreviousToTime (time) {
    return this.getMempoolTransactionsBeforeTimeStmt.raw(true).all(time)
  }

  async searchTxsToDownload () {
    return this.getTransactionsToDownloadStmt.raw(true).all()
  }

  async countDownloadedTxs () {
    return this.getTransactionsDownloadedCountStmt.get().count
  }

  async countIndexedTxs () {
    return this.getTransactionsIndexedCountStmt.get().count
  }

  async getFailedTx (deptxid) {
    return this.getTransactionFailedStmt.get(deptxid).failed
  }

  async addNewTx (txid, time) {
    await this.addNewTransactionStmt.run(txid, time)
  }

  async setTxHeight (txid, height) {
    this.setTransactionHeightStmt.run(height, txid)
  }

  async setTxTime (txid, time) {
    this.setTransactionTimeStmt.run(time, txid)
  }

  async setTxBytes (txid, bytes) {
    this.setTransactionBytesStmt.run(bytes, txid)
  }

  async setExecutableForTx (txid, executable) {
    this.setTransactionExecutableStmt.run(executable, txid)
  }

  async setHasCodeForTx (txid, hasCode) {
    this.setTransactionHasCodeStmt.run(hasCode, txid)
  }

  async setExecutedForTx (txid, executed) {
    this.setTransactionExecutedStmt.run(executed, txid)
  }

  async setIndexedForTx (txid, indexed) {
    this.setTransactionIndexedStmt.run(indexed, txid)
  }

  async txIsIndexed (txid) {
    return this.getTransactionIndexedStmt.raw(true).get(txid)[0]
  }

  async hasFailedDep (txid) {
    return this.hasFailedDepStmt.raw(true).get(txid)[0]
  }

  async checkTxWasExecuted (txid) {
    const queryResult = this.getTransactionWasExecutedStmt.raw(true).get(txid)
    return queryResult && !!queryResult[0]
  }

  async getTxHex (txid) {
    const row = this.getTransactionHexStmt.raw(true).get(txid)
    return row && row[0]
  }

  async getTxTime (txid) {
    const row = this.getTransactionTimeStmt.raw(true).get(txid)
    return row && row[0]
  }

  async getTxHeight (txid) {
    const row = this.getTransactionHeightStmt.raw(true).get(txid)
    return row && row[0]
  }

  async deleteTx (txid) {
    this.deleteTransactionStmt.run(txid)
  }

  async unconfirmTx (txid) {
    this.unconfirmTransactionStmt.run(txid)
  }

  async getTxMetadata (txid) {
    return this.getTxMetadataStmt.get(txid)
  }

  // executing

  async markTxAsExecuting (txid) {
    this.markExecutingStmt.run(txid)
  }

  async removeTxFromExecuting (txid) {
    this.unmarkExecutingStmt.run(txid)
  }

  async findAllExecutingTxids () {
    return this.findAllExecutingTxidsStmt.raw(true).all().map(x => x[0])
  }

  async txidTrustedAndReadyToExecute (txid) {
    const row = this.isTrustedAndReadyToExecuteStmt.get(txid)
    return row && row.ready
  }

  async txidIsReadyToExecute (txid) {
    const row = this.isReadyToExecuteStmt.get(txid)
    return !!(row && row.ready)
  }

  async checkDependenciesWereExecutedOk (txid) {
    const row = this.depsExecutedOkStmt.get(txid)
    return row && row.ok
  }

  // spends

  async getSpendingTxid (location) {
    const row = this.getSpendStmt.raw(true).get(location)
    return row && row[0]
  }

  async upsertSpend (location, txid) {
    await this.setSpendStmt.run(location, txid)
  }

  async setAsUnspent (location) {
    this.setUnspentStmt.run(location)
  }

  async deleteSpendsForTxid (txid) {
    this.deleteSpendsStmt.run(txid)
  }

  async unspendOutput (txid) {
    this.unspendOutputsStmt.run(txid)
  }

  // deps

  async addDep (deptxid, txid) {
    this.addDepStmt.run(deptxid, txid)
  }

  async searchDownstreamTxidsReadyToExecute (txid) {
    return this.getDownstreamReadyToExecuteStmt.raw(true).all(txid).map(x => x[0])
  }

  async searchDownstreamForTxid (txid) {
    return this.getDownstreamStmt.raw(true).all(txid).map(x => x[0])
  }

  async deleteDepsForTxid (txid) {
    this.deleteDepsStmt.run(txid)
  }

  async getNonExecutedUpstreamTxIds (txid) {
    return this.getUpstreamUnexecutedCodeStmt.raw(true).all(txid).map(x => x[0])
  }

  // jig

  async setJigMetadata (location) {
    this.setJigMetadataStmt.run(location)
  }

  async getJigState (location) {
    const row = this.getJigStateStmt.raw(true).get(location)
    if (row && row[0]) {
      return JSON.parse(row[0])
    } else {
      return null
    }
  }

  async setJigState (location, stateObject) {
    this.setJigStateStmt.run(location, JSON.stringify(stateObject))
  }

  async setBerryState (location, stateObject) {
    this.setBerryStateStmt.run(location, JSON.stringify(stateObject))
  }

  async setBerryMetadata (location) {
    this.setBerryMetadataStmt.run(location)
  }

  async getBerryState (location) {
    const row = this.getBerryStateStmt.raw(true).get(location)
    if (row && row[0]) {
      return JSON.parse(row[0])
    } else {
      return null
    }
  }

  async setJigClass (location, cls) {
    this.setJigClassStmt.run(cls, location)
  }

  async setJigLock (location, lock) {
    this.setJigLockStmt.run(lock, location)
  }

  async setJigScriptHash (location, scriptHash) {
    this.setJigScripthashStmt.run(scriptHash, location)
  }

  async deleteJigStatesForTxid (txid) {
    this.deleteJigStatesStmt.run(txid)
  }

  async deleteBerryStatesForTxid (txid) {
    this.deleteBerryStatesStmt.run(txid)
  }

  // unspent

  async getAllUnspent () {
    return this.getAllUnspentStmt.raw(true).all().map(row => row[0])
  }

  async getAllUnspentByClassOrigin (origin) {
    return this.getAllUnspentByClassStmt.raw(true).all(origin).map(row => row[0])
  }

  async getAllUnspentByLockOrigin (origin) {
    return this.getAllUnspentByLockStmt.raw(true).all(origin).map(row => row[0])
  }

  async getAllUnspentByScripthash (scripthash) {
    return this.getAllUnspentByScripthashStmt.raw(true).all(scripthash).map(row => row[0])
  }

  async getAllUnspentByClassOriginAndLockOrigin (clsOrigin, lockOrigin) {
    return this.getAllUnspentByClassLockStmt.raw(true).all(clsOrigin, lockOrigin).map(row => row[0])
  }

  async getAllUnspentByClassOriginAndScripthash (clsOrigin, scripthash) {
    return this.getAllUnspentByClassScripthashStmt.raw(true).all(clsOrigin, scripthash).map(row => row[0])
  }

  async getAllUnspentByLockOriginAndScripthash (lockOrigin, scripthash) {
    return this.getAllUnspentByLockScripthashStmt.raw(true).all(lockOrigin, scripthash).map(row => row[0])
  }

  async getAllUnspentByClassOriginAndLockOriginAndScriptHash (clsOrigin, lockOrigin, scripthash) {
    return this.getAllUnspentByClassLockScripthashStmt.raw(true).all(clsOrigin, lockOrigin, scripthash).map(row => row[0])
  }

  async countTotalUnspent () {
    return this.getNumUnspentStmt.get().unspent
  }

  // trust

  async isTrusted (txid) {
    const row = this.isTrustedStmt.raw(true).get(txid)
    return !!row && !!row[0]
  }

  async setTrust (txid, trusted) {
    this.setTrustedStmt.run(txid, trusted)
  }

  async searchAllTrust () {
    return this.getTrustlistStmt.raw(true).all().map(x => x[0])
  }

  // ban

  async checkIsBanned (txid) {
    const row = this.isBannedStmt.raw(true).get(txid)
    return !!row && !!row[0]
  }

  async saveBan (txid) {
    this.banStmt.run(txid)
  }

  async removeBan (txid) {
    this.unbanStmt.run(txid)
  }

  async searchAllBans () {
    return this.getBanlistStmt.raw(true).all().map(x => x[0])
  }

  // crawl

  async setCrawlHeight (heigth) {
    this.setHeightStmt.run(heigth.toString())
  }

  async setCrawlHash (hash) {
    this.setHashStmt.run(hash)
  }

  async nullCrawlHash () {
    this.setHashStmt.run(null)
  }

  async getCrawlHeight () {
    const row = this.getHeightStmt.raw(true).all()[0]
    return row && parseInt(row[0])
  }

  async getCrawlHash () {
    const row = this.getHashStmt.raw(true).all()[0]
    return row && row[0]
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = { SqliteDatasource }
