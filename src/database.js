/**
 * database.js
 *
 * Database manager
 */

const Sqlite3Database = require('better-sqlite3')

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
        executed INTEGER
      )`
    ).run()

    this.db.prepare(
      'CREATE UNIQUE INDEX IF NOT EXISTS txid_index ON tx (txid)'
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
        txid TEXT NOT NULL PRIMARY KEY
      ) WITHOUT ROWID`
    ).run()

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS crawl (
        role TEXT UNIQUE,
        height INTEGER,
        hash TEXT
      )`
    ).run()

    this.db.prepare('INSERT OR IGNORE INTO crawl (role, height, hash) VALUES (\'tip\', 0, NULL)').run()

    this.addNewTransactionStmt = this.db.prepare('INSERT OR IGNORE INTO tx (txid, hex, height, executable, executed) VALUES (?, null, ?, 0, 0)')
    this.setTransactionHexStmt = this.db.prepare('UPDATE tx SET hex = ? WHERE txid = ?')
    this.setTransactionHeightStmt = this.db.prepare('UPDATE tx SET height = ? WHERE txid = ?')
    this.setTransactionExecutableStmt = this.db.prepare('UPDATE tx SET executable = ? WHERE txid = ?')
    this.setTransactionExecutedStmt = this.db.prepare('UPDATE tx SET executed = ? WHERE txid = ?')
    this.getTransactionsStmt = this.db.prepare('SELECT txid, hex, executable, executed FROM tx')
    this.getTransactionsAboveHeightStmt = this.db.prepare('SELECT txid FROM tx WHERE height > ?')
    this.deleteTransactionStmt = this.db.prepare('DELETE FROM tx WHERE txid = ?')
    this.getTransactionHexStmt = this.db.prepare('SELECT hex FROM tx WHERE txid = ?')

    this.setJigStateStmt = this.db.prepare('INSERT OR IGNORE INTO jig (location, state) VALUES (?, ?)')
    this.getJigStateStmt = this.db.prepare('SELECT state FROM jig WHERE location = ?')
    this.deleteJigStatesStmt = this.db.prepare('DELETE FROM jig WHERE location LIKE ?')

    this.setBerryStateStmt = this.db.prepare('INSERT OR IGNORE INTO berry (location, state) VALUES (?, ?)')
    this.getBerryStateStmt = this.db.prepare('SELECT state FROM berry WHERE location = ?')
    this.deleteBerryStatesStmt = this.db.prepare('DELETE FROM berry WHERE location LIKE ? || \'?\'')

    this.getTrustlistStmt = this.db.prepare('SELECT txid FROM trust')
    this.addToTrustlistStmt = this.db.prepare('INSERT OR IGNORE INTO trust (txid) VALUES (?)')
    this.removeFromTrustlistStmt = this.db.prepare('DELETE FROM trust WHERE txid = ?')

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
    this.db.transaction(f)()
  }

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

  forEachTransaction (callback) {
    for (const row of this.getTransactionsStmt.iterate()) {
      callback(row.txid, row.hex, !!row.executable, !!row.executed)
    }
  }

  getTransactionsAboveHeight (height) {
    return this.getTransactionsAboveHeightStmt.all(height).map(row => row.txid)
  }

  deleteTransaction (txid) {
    this.deleteTransactionStmt.run(txid)
  }

  getTransactionHex (txid) {
    const row = this.getTransactionHexStmt.get(txid)
    return row && row.hex
  }

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

  getTrustlist () {
    return this.getTrustlistStmt.all().map(row => row.txid)
  }

  addToTrustlist (txid) {
    this.addToTrustlistStmt.run(txid)
  }

  removeFromTrustlist (txid) {
    this.removeFromTrustlistStmt.run(txid)
  }

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
