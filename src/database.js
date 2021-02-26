/**
 * database.js
 *
 * Database manager
 */

const Sqlite3Database = require('better-sqlite3')
const { DEFAULT_TRUSTLIST } = require('./config')

// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------

class Database {
  constructor (path) {
    this.path = path
    this.db = null
  }

  open () {
    if (this.db) throw new Error('Database already open')

    this.db = new Sqlite3Database(this.path)

    this.db.pragma('cache_size = 128000')
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = OFF')
    this.db.pragma('journal_mode = MEMORY')

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS tx (
        txid TEXT NOT NULL,
        height INTEGER,
        hex TEXT,
        has_code INTEGER,
        executed INTEGER,
        indexed INTEGER,
        downloaded INTEGER GENERATED ALWAYS AS (hex IS NOT NULL) VIRTUAL,
        executable INTEGER GENERATED ALWAYS AS (downloaded = 1 AND executed = 0 AND indexed = 0) VIRTUAL
      )`
    ).run()

    this.db.prepare(
      'CREATE INDEX IF NOT EXISTS tx_txid_index ON tx (txid)'
    ).run()

    this.db.prepare(
      'CREATE INDEX IF NOT EXISTS tx_executable_code_index ON tx (executable, has_code)'
    ).run()

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS deps (
        up TEXT NOT NULL,
        down TEXT NOT NULL,
        UNIQUE(up, down)
      )`
    ).run()

    this.db.prepare(
      'CREATE INDEX IF NOT EXISTS deps_up_index ON deps (up)'
    ).run()

    this.db.prepare(
      'CREATE INDEX IF NOT EXISTS deps_down_index ON deps (down)'
    ).run()

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS jig (
        location TEXT NOT NULL PRIMARY KEY,
        state TEXT NOT NULL
      ) WITHOUT ROWID`
    ).run()

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS berry (
        location TEXT NOT NULL PRIMARY KEY,
        state TEXT NOT NULL
      ) WITHOUT ROWID`
    ).run()

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS trust (
        txid TEXT NOT NULL PRIMARY KEY,
        value INTEGER
      ) WITHOUT ROWID`
    ).run()

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS crawl (
        role TEXT UNIQUE,
        height INTEGER,
        hash TEXT
      )`
    ).run()

    this.db.prepare(`
      CREATE VIEW IF NOT EXISTS tx_executable
      AS
      SELECT tx_executable_without_code.txid
      FROM (SELECT txid FROM tx WHERE executable = 1 AND has_code = 0) as tx_executable_without_code
      UNION ALL
      SELECT tx_executable_with_code.txid
      FROM (SELECT txid FROM tx WHERE executable = 1 AND has_code = 1) as tx_executable_with_code
      LEFT JOIN trust
      ON tx_executable_with_code.txid = trust.txid
      WHERE trust.value = 1
    `).run()

    this.db.prepare(`
      CREATE VIEW IF NOT EXISTS tx_upstream_unindexed
      AS
      SELECT deps.down as txid
      FROM (SELECT txid FROM tx WHERE indexed = 0) as tx_unindexed
      INNER JOIN deps
      ON deps.up = tx_unindexed.txid
    `).run()

    const setupCrawlStmt = this.db.prepare('INSERT OR IGNORE INTO crawl (role, height, hash) VALUES (\'tip\', 0, NULL)')
    const trustIfMissingStmt = this.db.prepare('INSERT OR IGNORE INTO trust (txid, value) VALUES (?, 1)')

    this.transaction(() => {
      setupCrawlStmt.run()
      for (const txid of DEFAULT_TRUSTLIST) {
        trustIfMissingStmt.run(txid)
      }
    })

    this.addNewTransactionStmt = this.db.prepare('INSERT OR IGNORE INTO tx (txid, hex, height, has_code, executed, indexed) VALUES (?, null, ?, 0, 0, 0)')
    this.setTransactionHexStmt = this.db.prepare('UPDATE tx SET hex = ? WHERE txid = ?')
    this.setTransactionHeightStmt = this.db.prepare('UPDATE tx SET height = ? WHERE txid = ?')
    this.setTransactionHasCodeStmt = this.db.prepare('UPDATE tx SET has_code = ? WHERE txid = ?')
    this.setTransactionExecutedStmt = this.db.prepare('UPDATE tx SET executed = ? WHERE txid = ?')
    this.setTransactionIndexedStmt = this.db.prepare('UPDATE tx SET indexed = ? WHERE txid = ?')
    this.hasTransactionStmt = this.db.prepare('SELECT txid FROM tx WHERE txid = ?')
    this.isTransactionDownloadedStmt = this.db.prepare('SELECT txid FROM tx WHERE txid = ? AND downloaded = 1')
    this.getTransactionHexStmt = this.db.prepare('SELECT hex FROM tx WHERE txid = ?')
    this.deleteTransactionStmt = this.db.prepare('DELETE FROM tx WHERE txid = ?')
    this.getTransactionsAboveHeightStmt = this.db.prepare('SELECT txid FROM tx WHERE height > ?')
    this.getTransactionsToDownloadStmt = this.db.prepare('SELECT txid FROM tx WHERE downloaded = 0')
    this.getTransactionsDownloadedCountStmt = this.db.prepare('SELECT COUNT(*) AS count FROM tx WHERE downloaded = 1')
    this.getTransactionsIndexedCountStmt = this.db.prepare('SELECT COUNT(*) AS count FROM tx WHERE indexed = 1')

    this.addDepStmt = this.db.prepare('INSERT OR IGNORE INTO deps (up, down) VALUES (?, ?)')
    this.isReadyToExecuteStmt = this.db.prepare(`
      SELECT
        unindexed AND trusted AND no_upstream as ready
      FROM
        (
          SELECT COUNT(*) > 0 as unindexed
          FROM tx
          WHERE txid = ? AND executable = 1
        ),
        (
          SELECT COUNT(*) > 0 as trusted
          FROM (SELECT * FROM tx WHERE txid = ?) AS tx
          LEFT JOIN trust
          ON trust.txid = tx.txid
          WHERE trust.value = 1 OR tx.has_code = 0
        ),
        (
          SELECT COUNT(*) = 0 AS no_upstream
          FROM tx
          INNER JOIN deps
          ON deps.up = tx.txid
          WHERE deps.down = ? AND tx.indexed = 0
        )
    `)
    this.getTransactionsToExecuteStmt = this.db.prepare(`
      SELECT txid
      FROM tx_executable
      EXCEPT
        SELECT deps.down as txid
        FROM (SELECT txid FROM tx WHERE indexed = 0) as tx_unindexed
        INNER JOIN deps
        ON deps.up = tx_unindexed.txid
    `)
    // this.getDownstreamToExecuteStmt = this.db.prepare(`
    // `)
    this.getRemainingToExecuteStmt = this.db.prepare(`
      WITH RECURSIVE
      remaining(txid) AS (
        SELECT txid
        FROM tx_executable
        EXCEPT
        SELECT txid
        FROM tx_upstream_unindexed

        UNION

        SELECT deps.down AS txid
        FROM deps, remaining
        INNER JOIN tx_executable
        ON tx_executable.txid = deps.down
        WHERE deps.up = remaining.txid
      )
      SELECT COUNT(txid) FROM remaining;
    `)

    this.setJigStateStmt = this.db.prepare('INSERT OR IGNORE INTO jig (location, state) VALUES (?, ?)')
    this.getJigStateStmt = this.db.prepare('SELECT state FROM jig WHERE location = ?')
    this.deleteJigStatesStmt = this.db.prepare('DELETE FROM jig WHERE location LIKE ? || \'%\'')

    this.setBerryStateStmt = this.db.prepare('INSERT OR IGNORE INTO berry (location, state) VALUES (?, ?)')
    this.getBerryStateStmt = this.db.prepare('SELECT state FROM berry WHERE location = ?')
    this.deleteBerryStatesStmt = this.db.prepare('DELETE FROM berry WHERE location LIKE ? || \'%\'')

    this.isTrustedStmt = this.db.prepare('SELECT value FROM trust WHERE txid = ?')
    this.setTrustedStmt = this.db.prepare('INSERT OR REPLACE INTO trust (txid, value) VALUES (?, ?)')
    this.getTrustlistStmt = this.db.prepare('SELECT txid FROM trust WHERE value = 1')

    this.getHeightStmt = this.db.prepare('SELECT height FROM crawl WHERE role = \'tip\'')
    this.getHashStmt = this.db.prepare('SELECT hash FROM crawl WHERE role = \'tip\'')
    this.setHeightAndHashStmt = this.db.prepare('UPDATE crawl SET height = ?, hash = ? WHERE role = \'tip\'')
  }

  close () {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  transaction (f) {
    if (!this.db) return
    this.db.transaction(f)()
  }

  // --------------------------------------------------------------------------
  // tx
  // --------------------------------------------------------------------------

  addNewTransaction (txid, height = null) {
    this.addNewTransactionStmt.run(txid, height)
  }

  setTransactionHex (txid, hex) {
    this.setTransactionHexStmt.run(hex, txid)
  }

  setTransactionHeight (txid, height) {
    this.setTransactionHeightStmt.run(height, txid)
  }

  setTransactionHasCode (txid, hasCode) {
    this.setTransactionHasCodeStmt.run(hasCode ? 1 : 0, txid)
  }

  setTransactionExecuted (txid, executed) {
    this.setTransactionExecutedStmt.run(executed ? 1 : 0, txid)
  }

  setTransactionIndexed (txid, indexed) {
    this.setTransactionIndexedStmt.run(indexed ? 1 : 0, txid)
  }

  hasTransaction (txid) {
    return !!this.hasTransactionStmt.get(txid)
  }

  isTransactionDownloaded (txid) {
    return !!this.isTransactionDownloadedStmt.get(txid)
  }

  getTransactionHex (txid) {
    const row = this.getTransactionHexStmt.get(txid)
    return row && row.hex
  }

  deleteTransaction (txid) {
    this.deleteTransactionStmt.run(txid)
  }

  getTransactionsAboveHeight (height) {
    return this.getTransactionsAboveHeightStmt.all().map(row => row.txid)
  }

  getTransactionsToDownload () {
    return this.getTransactionsToDownloadStmt.raw(true).all().map(row => row[0])
  }

  getDownloadedCount () {
    return this.getTransactionsDownloadedCountStmt.get().count
  }

  getIndexedCount () {
    return this.getTransactionsIndexedCountStmt.get().count
  }

  // --------------------------------------------------------------------------
  // deps
  // --------------------------------------------------------------------------

  addDep (up, down) {
    this.addDepStmt.run(up, down)
  }

  isReadyToExecute (txid) {
    return !!this.isReadyToExecuteStmt.get(txid, txid, txid).ready
  }

  getTransactionsToExecute () {
    return this.getTransactionsToExecuteStmt.raw(true).all().map(row => row[0])
  }

  getDownstreamToExecute (txid) {
    return this.getDownstreamToExecute.iterate(() => {})// all().map(row => row.txid)
  }

  getRemainingToExecute () {
    return this.getRemainingToExecuteStmt.raw(true).get()[0]
  }

  // --------------------------------------------------------------------------
  // jig
  // --------------------------------------------------------------------------

  setJigState (location, state) {
    this.setJigStateStmt.run(location, state)
  }

  getJigState (location) {
    const row = this.getJigStateStmt.get(location)
    return row && row.state
  }

  deleteJigStates (txid) {
    this.deleteJigStatesStmt.run(txid)
  }

  // --------------------------------------------------------------------------
  // berry
  // --------------------------------------------------------------------------

  setBerryState (location, state) {
    this.setBerryStateStmt.run(location, state)
  }

  getBerryState (location) {
    const row = this.getBerryStateStmt.get(location)
    return row && row.state
  }

  deleteBerryStates (txid) {
    this.deleteBerryStatesStmt.run(txid)
  }

  // --------------------------------------------------------------------------
  // trust
  // --------------------------------------------------------------------------

  isTrusted (txid) {
    const row = this.isTrustedStmt.get(txid)
    return !!(row && row.value)
  }

  setTrusted (txid, value) {
    this.setTrustedStmt.run(txid, value ? 1 : 0)
  }

  getTrustlist () {
    return this.getTrustlistStmt.all().map(row => row.txid)
  }

  // --------------------------------------------------------------------------
  // crawl
  // --------------------------------------------------------------------------

  getHeight () {
    const row = this.getHeightStmt.all()[0]
    return row && row.height
  }

  getHash () {
    const row = this.getHashStmt.all()[0]
    return row && row.hash
  }

  setHeightAndHash (height, hash) {
    this.setHeightAndHashStmt.run(height, hash)
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Database
