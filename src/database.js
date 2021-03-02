/**
 * database.js
 *
 * Layer between the database and the application
 */

const Sqlite3Database = require('better-sqlite3')
const { DEFAULT_TRUSTLIST } = require('./config')

// ------------------------------------------------------------------------------------------------
// Tx
// ------------------------------------------------------------------------------------------------

class Tx {
  constructor (txid, downloaded, hasCode) {
    this.txid = txid
    this.hasCode = hasCode
    this.pendingExecution = false
    this.upstream = new Set()
    this.downstream = new Set()
  }
}

// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------

class Database {
  constructor (path) {
    this.path = path
    this.db = null
    this.trustlist = null
    this.unexecutedTransactions = null
    this.untrustedTransactions = null
    this.numPendingExecution = null

    this.onReadyToExecute = null
    this.onAddTransaction = null
    this.onDeleteTransaction = null
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
        indexed INTEGER,
        UNIQUE(txid)
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
    this.getTransactionHexStmt = this.db.prepare('SELECT hex FROM tx WHERE txid = ?')
    this.getTransactionIndexedStmt = this.db.prepare('SELECT indexed FROM tx WHERE txid = ?')
    this.getTransactionDownloadedStmt = this.db.prepare('SELECT hex IS NOT NULL AS downloaded FROM tx WHERE txid = ?')
    this.deleteTransactionStmt = this.db.prepare('DELETE FROM tx WHERE txid = ?')
    this.getTransactionsAboveHeightStmt = this.db.prepare('SELECT txid FROM tx WHERE height > ?')
    this.getTransactionsToDownloadStmt = this.db.prepare('SELECT txid FROM tx WHERE hex IS NULL')
    this.getTransactionsDownloadedCountStmt = this.db.prepare('SELECT COUNT(*) AS count FROM tx WHERE hex IS NOT NULL')
    this.getTransactionsIndexedCountStmt = this.db.prepare('SELECT COUNT(*) AS count FROM tx WHERE indexed = 1')

    this.addDepStmt = this.db.prepare('INSERT OR IGNORE INTO deps (up, down) VALUES (?, ?)')
    this.deleteDepsStmt = this.db.prepare('DELETE FROM deps WHERE down = ?')
    this.getDownstreamStmt = this.db.prepare('SELECT down FROM deps WHERE up = ?')

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

    this.getUnexecutedStmt = this.db.prepare(
      'SELECT txid, hex IS NOT NULL AS downloaded, has_code FROM tx WHERE (executable = 1 AND executed = 0) OR hex IS NULL'
    )

    this.getUnexecutedDepsStmt = this.db.prepare(`
      SELECT deps.up as up, deps.down as down FROM deps
      JOIN tx ON tx.txid = deps.down
      WHERE tx.executable = 1 AND tx.executed = 0
    `)

    this.untrustedTransactions = new Set()
    this.unexecutedTransactions = new Map()
    const readyToExecute = new Set()

    const unexecuted = this.getUnexecutedStmt.raw(true).all()
    for (const [txid, downloaded, hasCode] of unexecuted) {
      const tx = new Tx(txid, downloaded, hasCode)
      this.unexecutedTransactions.set(txid, tx)
      const untrusted = hasCode && !this.trustlist.has(txid)
      if (untrusted) this.untrustedTransactions.add(txid)
      if (downloaded && !untrusted) readyToExecute.add(tx)
    }

    for (const [up, down] of this.getUnexecutedDepsStmt.raw(true).all()) {
      const uptx = this.unexecutedTransactions.get(up)
      if (!uptx) continue
      const downtx = this.unexecutedTransactions.get(down)
      downtx.upstream.add(uptx)
      uptx.downstream.add(downtx)
      readyToExecute.delete(downtx)
    }

    this.numPendingExecution = readyToExecute.size
    readyToExecute.forEach(tx => { tx.pendingExecution = true })
    this._markPendingExecution(readyToExecute)

    for (const tx of readyToExecute) {
      this.onReadyToExecute(tx.txid)
    }
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

  _markPendingExecution (start) {
    const queue = [...start]

    while (queue.length) {
      const tx = queue.shift()
      for (const downtx of tx.downstream) {
        if (downtx.pendingExecution) continue

        downtx.pendingExecution = (!downtx.hasCode || this.trustlist.has(downtx.txid)) &&
          Array.from(downtx.upstream).every(uptx => uptx.pendingExecution)

        if (downtx.pendingExecution) {
          this.numPendingExecution++
          queue.push(downtx)
        }
      }
    }
  }

  _markNotPendingExecution (start) {
    const queue = [...start]
    while (queue.length) {
      const tx = queue.shift()
      for (const downtx of tx.downstream) {
        if (!downtx.pendingExecution) continue
        downtx.pendingExecution = false
        this.numPendingExecution--
        queue.push(downtx)
      }
    }
  }

  // --------------------------------------------------------------------------
  // tx
  // --------------------------------------------------------------------------

  addNewTransaction (txid, height = null) {
    if (this.hasTransaction(txid)) return

    this.addNewTransactionStmt.run(txid, height)

    if (this.onAddTransaction) this.onAddTransaction(txid)

    if (!this.unexecutedTransactions.has(txid)) {
      const tx = new Tx(txid, false, null)
      this.unexecutedTransactions.set(txid, tx)
    }
  }

  updateTransactionHeight (txid, height) {
    this.setTransactionHeightStmt.run(height, txid)
  }

  // Non-executable might be berry data. We execute once we receive them.
  storeParsedNonExecutableTransaction (txid, hex) {
    this.transaction(() => {
      this.setTransactionHexStmt.run(hex, txid)
      this.setTransactionExecutableStmt.run(0, txid)

      const tx = this.unexecutedTransactions.get(txid)

      this.unexecutedTransactions.delete(txid)

      for (const downtx of tx.downstream) {
        downtx.upstream.delete(tx)

        downtx.pendingExecution = (!downtx.hasCode || this.trustlist.has(downtx.txid)) &&
          !Array.from(downtx.upstream).some(uptx => !uptx.pendingExecution)

        if (downtx.pendingExecution) {
          this.numPendingExecution++
          this._markPendingExecution([downtx])
          this.onReadyToExecute(downtx.txid)
        }
      }
    })
  }

  storeParsedExecutableTransaction (txid, hex, hasCode, deps) {
    this.transaction(() => {
      this.setTransactionHexStmt.run(hex, txid)
      this.setTransactionExecutableStmt.run(1, txid)
      this.setTransactionHasCodeStmt.run(hasCode ? 1 : 0, txid)

      const tx = this.unexecutedTransactions.get(txid)

      tx.hasCode = hasCode

      for (const deptxid of deps) {
        this.addNewTransaction(deptxid)
        this.addDepStmt.run(deptxid, txid)

        const deptx = this.unexecutedTransactions.get(deptxid)
        if (deptx) {
          deptx.downstream.add(tx)
          tx.upstream.add(deptx)
          continue
        }

        if (!this.getTransactionIndexedStmt.get(deptxid).indexed) {
          this.setTransactionExecutionFailed(txid)
          return
        }
      }

      tx.pendingExecution = (!hasCode || this.trustlist.has(txid)) &&
        !Array.from(tx.upstream).some(uptx => !uptx.pendingExecution)

      if (tx.pendingExecution) {
        this.numPendingExecution++

        this._markPendingExecution([tx])

        if (!tx.upstream.size) {
          this.onReadyToExecute(tx.txid)
        }
      } else {
        this._markNotPendingExecution([tx])
      }
    })
  }

  storeExecutedTransaction (txid, state) {
    const tx = this.unexecutedTransactions.get(txid)
    if (!tx) return

    this.transaction(() => {
      this.setTransactionExecutedStmt.run(1, txid)
      this.setTransactionIndexedStmt.run(1, txid)

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

      for (const downtx of tx.downstream) downtx.upstream.delete(tx)
      this.unexecutedTransactions.delete(txid)
      if (tx.pendingExecution) this.numPendingExecution--
      tx.pendingExecution = false

      for (const downtx of tx.downstream) {
        if (downtx.pendingExecution && !downtx.upstream.size) {
          this.onReadyToExecute(downtx.txid)
        }
      }
    })
  }

  setTransactionExecutionFailed (txid) {
    const tx = this.unexecutedTransactions.get(txid)
    if (!tx) return

    this.transaction(() => {
      this.setTransactionExecutableStmt.run(0, txid)
      this.setTransactionExecutedStmt.run(1, txid)
      this.setTransactionIndexedStmt.run(0, txid)

      this.unexecutedTransactions.delete(txid)
      if (tx.pendingExecution) this.numPendingExecution--

      for (const downtx of tx.downstream) {
        this.setTransactionExecutionFailed(downtx.txid)
      }
    })
  }

  getTransactionHex (txid) {
    const row = this.getTransactionHexStmt.raw(true).get(txid)
    return row && row[0]
  }

  deleteTransaction (txid) {
    this.transaction(() => {
      this.deleteTransactionStmt.run(txid)
      this.deleteJigStatesStmt.run(txid)
      this.deleteBerryStatesStmt.run(txid)
      this.deleteDepsStmt.run(txid)

      const tx = this.unexecutedTransactions.get(txid)
      if (tx && tx.pendingExecution) this.numPendingExecution--
      this.unexecutedTransactions.delete(txid)

      if (this.onDeleteTransaction) this.onDeleteTransaction(txid)

      const downtxids = this.getDownstreamStmt.raw(true).all(txid).map(row => row[0])
      downtxids.forEach(downtxid => this.deleteTransaction(downtxid))
    })
  }

  hasTransaction (txid) { return !!this.hasTransactionStmt.get(txid) }
  isTransactionDownloaded (txid) { return !!this.getTransactionDownloadedStmt.raw(true).get(txid)[0] }
  getTransactionsAboveHeight (height) { return this.getTransactionsAboveHeightStmt.raw(true).all().map(row => row[0]) }
  getTransactionsToDownload () { return this.getTransactionsToDownloadStmt.raw(true).all().map(row => row[0]) }
  getDownloadedCount () { return this.getTransactionsDownloadedCountStmt.get().count }
  getIndexedCount () { return this.getTransactionsIndexedCountStmt.get().count }
  getRemainingToExecute () { return this.numPendingExecution }

  // --------------------------------------------------------------------------
  // deps
  // --------------------------------------------------------------------------

  addMissingDeps (txid, deptxids) {
    const tx = this.unexecutedTransactions.get(txid)

    this.transaction(() => {
      if (tx.pendingExecution) {
        this.numPendingExecution--
        tx.pendingExecution = false
        this._markNotPendingExecution([tx])
      }

      for (const deptxid of deptxids) {
        this.addDep(tx, deptxid)
      }

      tx.pendingExecution = (!tx.hasCode || this.trustlist.has(tx.txid)) &&
        Array.from(tx.upstream).every(uptx => uptx.pendingExecution)

      if (tx.pendingExecution) {
        this.numPendingExecution++
        this._markPendingExecution([tx])
        if (!tx.upstream.size) this.onReadyToExecute(txid)
      }
    })
  }

  addDep (tx, deptxid) {
    this.addNewTransaction(deptxid)
    this.addDepStmt.run(deptxid, deptxid)

    const deptx = this.unexecutedTransactions.get(deptxid)
    if (deptx) {
      deptx.downstream.add(tx)
      tx.upstream.add(deptx)
    } else {
      if (!this.getTransactionIndexedStmt.get(deptxid).indexed) {
        this.setTransactionExecutionFailed(tx.txid)
      }
    }
  }

  // --------------------------------------------------------------------------
  // jig
  // --------------------------------------------------------------------------

  getJigState (location) {
    const row = this.getJigStateStmt.raw(true).get(location)
    return row && row[0]
  }

  // --------------------------------------------------------------------------
  // berry
  // --------------------------------------------------------------------------

  getBerryState (location) {
    const row = this.getBerryStateStmt.raw(true).get(location)
    return row && row[0]
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

      // TODO: Execute
    } else {
      this.trustlist.delete(txid)
    }
  }

  getTrustlist () {
    return Array.from(this.trustlist)
  }

  getAllUntrusted () {
    return Array.from(this.untrustedTransactions)
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
