/**
 * database.js
 *
 * Layer between the database and the application
 */
const { SqliteDatasource } = require('./sqlite-datasource')
const fetch = require('node-fetch')
const { HEIGHT_MEMPOOL } = require('../constants')

// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------

const IS_READY_TO_EXECUTE_SQL = `
      SELECT (
        executable = 1 AND 
        executed = 0 AND 
        (
          SELECT count(*)
          FROM tx AS txInner
          JOIN deps
          ON deps.up = txInner.txid
          WHERE deps.down = txOuter.txid AND 
                txInner.executable = 1 AND 
                txInner.indexed = 0
        ) = 0
      ) AS ready 
      FROM tx as txOuter
      WHERE txOuter.txid = ?;
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

class SqliteMixedDatasource extends SqliteDatasource {
  constructor (path, logger, readonly, blobStorage) {
    super(path, logger, readonly)
    this.blobStorage = blobStorage
  }

  prepareStatements () {
    this.addNewTransactionStmt = this.connection.prepare('INSERT OR IGNORE INTO tx (txid, height, time, has_code, executable, executed, indexed) VALUES (?, null, ?, 0, 0, 0, 0)')
    this.setTransactionExecutableStmt = this.connection.prepare('UPDATE tx SET executable = ? WHERE txid = ?')
    this.setTransactionTimeStmt = this.connection.prepare('UPDATE tx SET time = ? WHERE txid = ?')
    this.setTransactionHeightStmt = this.connection.prepare(`UPDATE tx SET height = ? WHERE txid = ? AND (height IS NULL OR height = ${HEIGHT_MEMPOOL})`)
    this.setTransactionHasCodeStmt = this.connection.prepare('UPDATE tx SET has_code = ? WHERE txid = ?')
    this.setTransactionExecutedStmt = this.connection.prepare('UPDATE tx SET executed = ? WHERE txid = ?')
    this.setTransactionIndexedStmt = this.connection.prepare('UPDATE tx SET indexed = ? WHERE txid = ?')
    this.getTransactionWasExecutedStmt = this.connection.prepare('SELECT executed FROM tx WHERE txid = ?')
    this.txExistsStmt = this.connection.prepare('SELECT txid FROM tx WHERE txid = ?')
    this.getTransactionTimeStmt = this.connection.prepare('SELECT time FROM tx WHERE txid = ?')
    this.getTransactionHeightStmt = this.connection.prepare('SELECT height FROM tx WHERE txid = ?')
    this.getTransactionHasCodeStmt = this.connection.prepare('SELECT has_code FROM tx WHERE txid = ?')
    this.getTransactionIndexedStmt = this.connection.prepare('SELECT indexed FROM tx WHERE txid = ?')
    this.getTransactionFailedStmt = this.connection.prepare('SELECT (executed = 1 AND indexed = 0) AS failed FROM tx WHERE txid = ?')
    // this.getTransactionDownloadedStmt = this.connection.prepare('SELECT downloaded FROM tx WHERE txid = ?')
    this.deleteTransactionStmt = this.connection.prepare('DELETE FROM tx WHERE txid = ?')
    this.unconfirmTransactionStmt = this.connection.prepare(`UPDATE tx SET height = ${HEIGHT_MEMPOOL} WHERE txid = ?`)
    this.getTransactionsAboveHeightStmt = this.connection.prepare('SELECT txid FROM tx WHERE height > ?')
    this.getMempoolTransactionsBeforeTimeStmt = this.connection.prepare(`SELECT txid FROM tx WHERE height = ${HEIGHT_MEMPOOL} AND time < ?`)
    this.getTransactionsToDownloadStmt = this.connection.prepare('SELECT txid FROM tx WHERE downloaded = 0')
    this.getTransactionsDownloadedCountStmt = this.connection.prepare('SELECT COUNT(*) AS count FROM tx WHERE downloaded = 1')
    this.getTransactionsIndexedCountStmt = this.connection.prepare('SELECT COUNT(*) AS count FROM tx WHERE indexed = 1')
    this.isReadyToExecuteStmt = this.connection.prepare(IS_READY_TO_EXECUTE_SQL)
    this.getDownstreamReadyToExecuteStmt = this.connection.prepare(GET_DOWNSTREAM_READY_TO_EXECUTE_SQL)

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

    this.setJigMetadataStmt = this.connection.prepare('INSERT OR IGNORE INTO jig (location)  VALUES (?)')
    this.setJigClassStmt = this.connection.prepare('UPDATE jig SET class = ? WHERE location = ?')
    this.setJigLockStmt = this.connection.prepare('UPDATE jig SET lock = ? WHERE location = ?')
    this.setJigScripthashStmt = this.connection.prepare('UPDATE jig SET scripthash = ? WHERE location = ?')
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

    this.deleteBerryStatesStmt = this.connection.prepare('DELETE FROM berry WHERE location LIKE ? || \'%\'')
    this.setBerryMetadataStmt = this.connection.prepare('INSERT OR IGNORE INTO berry (location) VALUES (?)')

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

    this.getTransactionsCountStmt = this.connection.prepare(`
      select count(*) as count from tx;
    `)
    this.addNewTransactionStmt = this.connection.prepare('INSERT OR IGNORE INTO tx (txid, height, time, has_code, executable, executed, indexed) VALUES (?, null, ?, 0, 0, 0, 0)')
  }

  async migrateSchema () {
    await this.initializeV1()
    await this.initializeV2()
    await this.initializeV3()
    await this.initializeV4()
    await this.initializeV5()
    await this.initializeV6()
    await this.initializeV7()
    await this.extraSchemaMigrations()
  }

  async extraSchemaMigrations () {
    this.logger.info('Setting up database extra migrations')
    this.connection.prepare(
      'DROP INDEX IF EXISTS tx_downloaded_index;'
    ).run()
    const txColumns = this.connection.pragma('table_info(tx)')

    if (txColumns.some(column => column.name === 'bytes')) {
      this.connection.prepare(
        'ALTER TABLE tx DROP COLUMN downloaded;'
      ).run()
      this.connection.prepare(
        'ALTER TABLE tx DROP COLUMN bytes;'
      ).run()
      this.connection.prepare(
        'ALTER TABLE tx ADD COLUMN downloaded INTEGER GENERATED ALWAYS AS (1) VIRTUAL'
      ).run()
    }

    const jigColumns = this.connection.pragma('table_info(jig)')
    if (jigColumns.some(column => column.name === 'state')) {
      this.connection.prepare(`
      ALTER TABLE jig DROP COLUMN state;
    `).run()
    }

    const berryColumns = this.connection.pragma('table_info(berry)')
    if (berryColumns.some(column => column.name === 'state')) {
      this.connection.prepare(`
      ALTER TABLE berry DROP COLUMN state;
    `).run()
    }
  }

  async getTxHex (txid) {
    const buff = await this.blobStorage.fetchTx(txid)
    return buff.toString('hex')
  }

  async setTxBytes (txid, bytes) {
    return null
  }

  // jig

  async getJigState (location) {
    return this.blobStorage.pullJigState(location)
  }

  async setJigState (location, stateObject) {
    // this.setJigMetadataStmt(location)
    await this.blobStorage.pushJigState(location, stateObject)
  }

  async getBerryState (location) {
    return this.blobStorage.pullJigState(location)
  }

  async setBerryMetadata (location) {
    this.setBerryMetadataStmt.run(location)
  }

  async setBerryState (location, stateObject) {
    return this.blobStorage.pushJigState(location, stateObject)
  }

  // tx

  async checkTxIsDownloaded (_txid) {
    return true
  }

  async countDownloadedTxs () {
    return this.getTransactionsCountStmt.get().count
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = { SqliteMixedDatasource }
