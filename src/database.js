/**
 * database.js
 *
 * Layer between the database and the application
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
    this.trustlist = null
    this.onReadyToExecute = null
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

    this.setTrustedStmt = this.db.prepare('INSERT OR REPLACE INTO trust (txid, value) VALUES (?, ?)')
    this.getTrustlistStmt = this.db.prepare('SELECT txid FROM trust WHERE value = 1')

    this.getHeightStmt = this.db.prepare('SELECT height FROM crawl WHERE role = \'tip\'')
    this.getHashStmt = this.db.prepare('SELECT hash FROM crawl WHERE role = \'tip\'')
    this.setHeightAndHashStmt = this.db.prepare('UPDATE crawl SET height = ?, hash = ? WHERE role = \'tip\'')

    this.trustlist = new Set(this.getTrustlistStmt.raw(true).all().map(row => row[0]))
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

  updateTransactionHeight (txid, height) {
    this.setTransactionHeightStmt.run(height, txid)
  }

  storeParsedTransaction (txid, hex, executable, hasCode, deps) {
    this.transaction(() => {
      this.setTransactionHexStmt.run(hex, txid)
      this.setTransactionExecutableStmt.run(executable ? 1 : 0, txid)
      this.setTransactionHasCodeStmt.run(hasCode ? 1 : 0, txid)
      if (deps) deps.forEach(deptxid => this.addDep(deptxid, txid))
      const tx = this.executionGraph.get(txid)
      if (tx && !tx.upstream.size) this.onReadyToExecute(tx.txid)
    })
  }

  storeExecutedTransaction (txid, state) {
    const tx = this.executionGraph.get(txid)
    if (!tx) return

    this.transaction(() => {
      this.setTransactionExecutedStmt.run(1, txid)
      this.setTransactionIndexedStmt.run(1, txid)

      if (state) {
        for (const key of Object.keys(state)) {
          if (key.startsWith('jig://')) {
            const location = key.slice('jig://'.length)
            this.setJigStateStmt.run(location, JSON.stringify(state[key]))
            continue
          }

          if (key.startsWith('berry://')) {
            const location = key.slice('berry://'.length)
            this.setBerryStateStmt.run(location, JSON.stringify(state[key]))
            continue
          }
        }
      }

      for (const downtx of tx.downstream) downtx.upstream.delete(tx)
      this.executionGraph.delete(txid)
      this.remaining--

      for (const downtx of tx.downstream) {
        if (!downtx.upstream.size) this.onReadyToExecute(downtx.txid)
      }
    })
  }

  storeFailedTransaction (txid) {
    const tx = this.executionGraph.get(txid)
    if (!tx) return

    this.transaction(() => {
      this.setTransactionExecutableStmt.run(0, txid)
      this.setTransactionExecutedStmt.run(1, txid)
      this.setTransactionIndexedStmt.run(0, txid)

      for (const downtx of tx.downstream) {
        this.storeFailedTransaction(downtx.txid)
      }
    })
  }

  getTransactionHex (txid) {
    const row = this.getTransactionHexStmt.raw(true).get(txid)
    return row && row[0]
  }

  deleteTransaction (txid) {
    this.deleteTransactionStmt.run(txid)
  }

  hasTransaction (txid) { return !!this.hasTransactionStmt.get(txid) }
  isTransactionDownloaded (txid) { return !!this.isTransactionDownloadedStmt.raw(true).get(txid) }
  getTransactionsAboveHeight (height) { return this.getTransactionsAboveHeightStmt.raw(true).all().map(row => row[0]) }
  getTransactionsToDownload () { return this.getTransactionsToDownloadStmt.raw(true).all().map(row => row[0]) }
  getDownloadedCount () { return this.getTransactionsDownloadedCountStmt.get().count }
  getIndexedCount () { return this.getTransactionsIndexedCountStmt.get().count }

  // --------------------------------------------------------------------------
  // deps
  // --------------------------------------------------------------------------

  addDep (up, down) {
    this.addDepStmt.run(up, down)
    const uptx = this.executionGraph.get(up)
    if (!uptx) return
    const downtx = this.executionGraph.get(down)
    if (!downtx) return
    uptx.downstream.add(downtx)
    downtx.upstream.add(uptx)
  }

  // --------------------------------------------------------------------------
  // jig
  // --------------------------------------------------------------------------

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
    return this.trustlist.has(txid)
  }

  setTrusted (txid, value) {
    this.setTrustedStmt.run(txid, value ? 1 : 0)
    if (value) {
      this.trustlist.add(txid)
    } else {
      this.trustlist.delete(txid)
    }
  }

  getTrustlist () {
    return Array.from(this.trustlist)
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

  // --------------------------------------------------------------------------
  // execution graph
  // --------------------------------------------------------------------------

  buildExecutionGraph () {
    this.getUnexecutedStmt = this.db.prepare(
      'SELECT txid, has_code FROM tx WHERE executable = 1 AND executed = 0'
    )

    this.getUnexecutedDepsStmt = this.db.prepare(`
      SELECT deps.up as up, deps.down as down FROM deps
      JOIN tx ON tx.txid = deps.down
      WHERE tx.executable = 1 AND tx.executed = 0
    `)

    class Tx {
      constructor (txid, hasCode) {
        this.txid = txid
        this.hasCode = hasCode
        this.remaining = false
        this.upstream = new Set()
        this.downstream = new Set()
      }
    }

    this.executionGraph = new Map()
    const readyToExecute = new Set()

    const unexecuted = this.getUnexecutedStmt.raw(true).all()
    for (const [txid, hasCode] of unexecuted) {
      const tx = new Tx(txid, !!hasCode)
      this.executionGraph.set(txid, tx)
      if (!hasCode || this.trustlist.has(txid)) readyToExecute.add(tx)
    }

    for (const [up, down] of this.getUnexecutedDepsStmt.raw(true).all()) {
      const uptx = this.executionGraph.get(up)
      if (!uptx) continue
      const downtx = this.executionGraph.get(down)
      downtx.upstream.add(uptx)
      uptx.downstream.add(downtx)
      readyToExecute.delete(downtx)
    }

    this.remaining = readyToExecute.size
    const queue = []
    for (const tx of readyToExecute) {
      tx.remaining = true
      queue.push(tx)
    }

    while (queue.length) {
      const tx = queue.shift()
      for (const downtx of tx.downstream) {
        if (downtx.remaining) continue
        downtx.remaining = Array.from(downtx.upstream).every(uptx => uptx.remaining)
        if (downtx.remaining) {
          this.remaining++
          queue.push(downtx)
        }
      }
    }

    for (const tx of readyToExecute) this.onReadyToExecute(tx.txid)
  }

  getRemainingToExecute () {
    return this.remaining
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Database
