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
        executable INTEGER,
        executed INTEGER,
        indexed INTEGER
      )`
    ).run()

    this.db.prepare(
      'CREATE INDEX IF NOT EXISTS tx_txid_index ON tx (txid)'
    ).run()

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS deps (
        up TEXT NOT NULL,
        down TEXT NOT NULL,
        UNIQUE(up, down)
      )`
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

    const setupCrawlStmt = this.db.prepare('INSERT OR IGNORE INTO crawl (role, height, hash) VALUES (\'tip\', 0, NULL)')
    const trustIfMissingStmt = this.db.prepare('INSERT OR IGNORE INTO trust (txid, value) VALUES (?, 1)')

    this.transaction(() => {
      setupCrawlStmt.run()
      for (const txid of DEFAULT_TRUSTLIST) {
        trustIfMissingStmt.run(txid)
      }
    })

    this.addNewTransactionStmt = this.db.prepare('INSERT OR IGNORE INTO tx (txid, hex, height, has_code, executable, executed, indexed) VALUES (?, null, ?, 0, 0, 0, 0)')
    this.setTransactionHexStmt = this.db.prepare('UPDATE tx SET hex = ? WHERE txid = ?')
    this.setTransactionExecutableStmt = this.db.prepare('UPDATE tx SET executable = ? WHERE txid = ?')
    this.setTransactionHeightStmt = this.db.prepare('UPDATE tx SET height = ? WHERE txid = ?')
    this.setTransactionHasCodeStmt = this.db.prepare('UPDATE tx SET has_code = ? WHERE txid = ?')
    this.setTransactionExecutedStmt = this.db.prepare('UPDATE tx SET executed = ? WHERE txid = ?')
    this.setTransactionIndexedStmt = this.db.prepare('UPDATE tx SET indexed = ? WHERE txid = ?')
    this.hasTransactionStmt = this.db.prepare('SELECT txid FROM tx WHERE txid = ?')
    this.isTransactionDownloadedStmt = this.db.prepare('SELECT txid FROM tx WHERE txid = ? AND hex IS NOT NULL')
    this.getTransactionHexStmt = this.db.prepare('SELECT hex FROM tx WHERE txid = ?')
    this.deleteTransactionStmt = this.db.prepare('DELETE FROM tx WHERE txid = ?')
    this.getTransactionsAboveHeightStmt = this.db.prepare('SELECT txid FROM tx WHERE height > ?')
    this.getTransactionsToDownloadStmt = this.db.prepare('SELECT txid FROM tx WHERE hex IS NULL')
    this.getTransactionsDownloadedCountStmt = this.db.prepare('SELECT COUNT(*) AS count FROM tx WHERE hex IS NOT NULL')
    this.getTransactionsIndexedCountStmt = this.db.prepare('SELECT COUNT(*) AS count FROM tx WHERE indexed = 1')

    this.addDepStmt = this.db.prepare('INSERT OR IGNORE INTO deps (up, down) VALUES (?, ?)')

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

  setTransactionExecutable (txid, executable) {
    this.setTransactionExecutableStmt.run(executable ? 1 : 0, txid)
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
    return !!this.isTransactionDownloadedStmt.raw(true).get(txid)
  }

  getTransactionHex (txid) {
    const row = this.getTransactionHexStmt.raw(true).get(txid)
    return row && row[0]
  }

  deleteTransaction (txid) {
    this.deleteTransactionStmt.run(txid)
  }

  getTransactionsAboveHeight (height) {
    return this.getTransactionsAboveHeightStmt.raw(true).all().map(row => row[0])
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

  getDownstream (txid) {
    return []
  }

  isReadyToExecute (txid) {
    return false
  }

  getTransactionsToExecute () {
    return []
  }

  getRemainingToExecute () {
    return 0
  }

  // --------------------------------------------------------------------------
  // jig
  // --------------------------------------------------------------------------

  setJigState (location, state) {
    this.setJigStateStmt.run(location, state)
  }

  getJigState (location) {
    const row = this.getJigStateStmt.raw(true).get(location)
    return row && row[0]
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
    const row = this.getBerryStateStmt.raw(true).get(location)
    return row && row[0]
  }

  deleteBerryStates (txid) {
    this.deleteBerryStatesStmt.run(txid)
  }

  // --------------------------------------------------------------------------
  // trust
  // --------------------------------------------------------------------------

  isTrusted (txid) {
    const row = this.isTrustedStmt.raw(true).get(txid)
    return !!(row && row[0])
  }

  setTrusted (txid, value) {
    this.setTrustedStmt.run(txid, value ? 1 : 0)
  }

  getTrustlist () {
    return this.getTrustlistStmt.raw(true).all().map(row => row[0])
  }

  // --------------------------------------------------------------------------
  // crawl
  // --------------------------------------------------------------------------

  getHeight () {
    const row = this.getHeightStmt.raw(true).all()[0]
    return row && row[0]
  }

  getHash () {
    const row = this.getHashStmt.raw(true).all()[0]
    return row && row[0]
  }

  setHeightAndHash (height, hash) {
    this.setHeightAndHashStmt.run(height, hash)
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Database
