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
        hex TEXT,
        height INTEGER,
        executable INTEGER,
        executed INTEGER,
        indexed INTEGER
      )`
    ).run()

    this.db.prepare(
      'CREATE UNIQUE INDEX IF NOT EXISTS tx_txid_index ON tx (txid)'
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
      'CREATE INDEX IF NOT EXISTS deps_down_index ON deps (up)'
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

    this.addNewTransactionStmt = this.db.prepare('INSERT OR IGNORE INTO tx (txid, hex, height, executable, executed, indexed) VALUES (?, null, ?, 0, 0, 0)')
    this.setTransactionHexStmt = this.db.prepare('UPDATE tx SET hex = ? WHERE txid = ?')
    this.setTransactionHeightStmt = this.db.prepare('UPDATE tx SET height = ? WHERE txid = ?')
    this.setTransactionExecutableStmt = this.db.prepare('UPDATE tx SET executable = ? WHERE txid = ?')
    this.setTransactionExecutedStmt = this.db.prepare('UPDATE tx SET executed = ? WHERE txid = ?')
    this.setTransactionIndexedStmt = this.db.prepare('UPDATE tx SET indexed = ? WHERE txid = ?')
    this.getTransactionsStmt = this.db.prepare('SELECT txid, hex, executable, executed, indexed FROM tx')
    this.getTransactionsAboveHeightStmt = this.db.prepare('SELECT txid FROM tx WHERE height > ?')
    this.deleteTransactionStmt = this.db.prepare('DELETE FROM tx WHERE txid = ?')
    this.getTransactionStmt = this.db.prepare('SELECT * FROM tx WHERE txid = ?')
    this.getTransactionsDownloadedCountStmt = this.db.prepare('SELECT COUNT(*) AS count FROM tx WHERE indexed = 1')
    this.getTransactionsIndexedCountStmt = this.db.prepare('SELECT COUNT(*) AS count FROM tx WHERE hex IS NOT NULL')

    this.addDepStmt = this.db.prepare('INSERT OR IGNORE INTO deps (up, down) VALUES (?, ?)')
    this.getUpstreamStmt = this.db.prepare('SELECT up AS txid FROM deps WHERE down = ?')
    this.getDownstreamStmt = this.db.prepare('SELECT down AS txid FROM deps WHERE up = ?')

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

  setTransactionExecutable (txid, executable) {
    this.setTransactionExecutableStmt.run(executable ? 1 : 0, txid)
  }

  setTransactionExecuted (txid, executed) {
    this.setTransactionExecutedStmt.run(executed ? 1 : 0, txid)
  }

  setTransactionIndexed (txid, indexed) {
    this.setTransactionIndexedStmt.run(indexed ? 1 : 0, txid)
  }

  forEachTransaction (callback) {
    for (const row of this.getTransactionsStmt.iterate()) {
      callback(row.txid, row.hex, !!row.executable, !!row.executed, !!row.indexed)
    }
  }

  getTransactionsAboveHeight (height) {
    return this.getTransactionsAboveHeightStmt.all(height).map(row => row.txid)
  }

  deleteTransaction (txid) {
    this.deleteTransactionStmt.run(txid)
  }

  getTransaction (txid) {
    const row = this.getTransactionStmt.get(txid)
    // TODO: Revisit once all txns are in the database
    return row
      ? { hex: row.hex, executable: !!row.executable, executed: !!row.executed, indexed: !!row.indexed }
      : { hex: null, executable: false, executed: false, indexed: false }
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

  getUpstream (txid) {
    this.getUpstreamStmt.all(txid).map(row => row.txid)
  }

  getDownstream (txid) {
    this.getDownstreamStmt.all(txid).map(row => row.txid)
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
