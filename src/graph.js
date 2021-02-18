/**
 * graph.js
 *
 * A graph of all Run transactions and their dependencies to calculate execution order.
 */

const bsv = require('bsv')
const Run = require('./run.node.min')

// ------------------------------------------------------------------------------------------------
// Graph
// ------------------------------------------------------------------------------------------------

class Graph {
  constructor (trustlist) {
    this.trustlist = trustlist
    this.onReadyToExecute = null
    this.onFailedToParse = null
    this.transactions = new Map()
    this.untrusted = new Set()
    this.remaining = new Set()
  }

  has (txid) {
    return this.transactions.has(txid)
  }

  add (txid, hex, executable, executed) {
    const tx = this.transactions.get(txid) || {}
    tx.downloaded = tx.downloaded || !!hex
    tx.executable = executable
    tx.executed = executed
    tx.upstream = tx.upstream || new Set()
    tx.downstream = tx.downstream || new Set()
    this.transactions.set(txid, tx)
    if (executed && tx.downstream.size) {
      for (const downtxid of tx.downstream) {
        const downtx = this.transactions.get(downtxid)
        downtx.upstream.delete(txid)
        this._updateRemaining(downtxid, downtx)
        this._checkIfReadyToExecute(downtxid, downtx)
      }
      tx.downstream.clear()
    }
    this._parseHex(txid, tx, hex)
    this._updateRemaining(txid, tx)
    this._checkIfReadyToExecute(txid, tx)
    return tx
  }

  setDownloaded (txid, hex) {
    const tx = this.transactions.get(txid)
    tx.downloaded = true
    this._parseHex(txid, tx, hex)
    this._updateRemaining(txid, tx)
    this._checkIfReadyToExecute(txid, tx)
    if (!tx.executable && tx.downstream.size) {
      for (const downtxid of tx.downstream) {
        const downtx = this.transactions.get(downtxid)
        downtx.upstream.delete(txid)
        this._updateRemaining(downtxid, downtx)
        this._checkIfReadyToExecute(downtxid, downtx)
      }
      tx.downstream.clear()
    }
  }

  setExecutable (txid) {
    const tx = this.transactions.get(txid)
    tx.executable = true
    this._updateRemaining(txid, tx)
    this._checkIfReadyToExecute(txid, tx)
  }

  setExecuted (txid) {
    const tx = this.transactions.get(txid)
    tx.executed = true
    for (const downtxid of tx.downstream) {
      const downtx = this.transactions.get(downtxid)
      downtx.upstream.delete(txid)
      this._checkIfReadyToExecute(downtxid, downtx)
    }
    this._updateRemaining(txid, tx)
    tx.downstream.clear()
  }

  addDep (txid, deptxid) {
    const tx = this.transactions.get(txid)
    const deptx = this._getOrAdd(deptxid)
    if (!deptx.executed) {
      tx.upstream.add(deptxid)
      deptx.downstream.add(txid)
      this._updateRemaining(txid, tx)
    } else {
      this._updateRemaining(txid, tx)
      this._checkIfReadyToExecute(txid, tx)
    }
  }

  remove (txid) {
    this.remaining.delete(txid)
    this.untrusted.delete(txid)
    const tx = this.transactions.get(txid)
    if (tx) {
      for (const uptxid of tx.upstream) {
        const uptx = this.transactions.get(uptxid)
        uptx.downstream.delete(txid)
      }
      for (const downtxid of tx.downstream) {
        const downtx = this.transactions.get(downtxid)
        this._updateRemaining(downtxid, downtx)
      }
      this.transactions.delete(txid)
    }
  }

  onTrust (txid) {
    if (this.untrusted.delete(txid)) {
      const tx = this._getOrAdd(txid)
      this._updateRemaining(txid, tx)
      this._checkIfReadyToExecute(txid, tx)
    }
  }

  onUntrust (txid) {
    this.untrusted.add(txid)
    const tx = this._getOrAdd(txid)
    this._updateRemaining(txid, tx)
  }

  _getOrAdd (txid) {
    const tx = this.transactions.get(txid)
    return tx || this.add(txid, null, false, false)
  }

  _parseHex (txid, tx, hex) {
    if (!tx.executable) return
    if (tx.executed) return
    if (!hex) return

    let metadata = null
    let bsvtx = null

    try {
      metadata = Run.util.metadata(hex)
      bsvtx = new bsv.Transaction(hex)
    } catch (e) {
      this.setExecuted(txid)
      if (this.onFailedToParse) this.onFailedToParse(txid)
      return
    }

    const deps = new Set()

    for (let i = 0; i < metadata.in; i++) {
      const prevtxid = bsvtx.inputs[i].prevTxId.toString('hex')
      deps.add(prevtxid)
    }

    for (const ref of metadata.ref) {
      if (ref.startsWith('native://')) {
        continue
      } else if (ref.includes('berry')) {
        const reftxid = ref.slice(0, 64)
        deps.add(reftxid)
      } else {
        const reftxid = ref.slice(0, 64)
        deps.add(reftxid)
      }
    }

    for (const deptxid of deps) {
      const deptx = this._getOrAdd(deptxid)
      if (!deptx.executed) {
        tx.upstream.add(deptxid)
        deptx.downstream.add(txid)
      }
    }

    const hasCode = metadata.exec.some(cmd => cmd.op === 'DEPLOY' || cmd.op === 'UPGRADE')
    const untrusted = hasCode && !this.trustlist.has(txid)
    if (untrusted) this.untrusted.add(txid)
  }

  _isRemaining (txid, tx) {
    if (!tx.downloaded) return false
    if (!tx.executable) return false
    if (tx.executed) return false
    if (this.untrusted.has(txid)) return false
    for (const uptxid of tx.upstream) {
      if (!this.remaining.has(uptxid)) {
        return false
      }
    }
    return true
  }

  _updateRemaining (txid, tx) {
    const newRemaining = this._isRemaining(txid, tx)
    const oldRemaining = this.remaining.has(txid)
    if (newRemaining === oldRemaining) return
    if (newRemaining) {
      this.remaining.add(txid)
      for (const downtxid of tx.downstream) {
        const downtx = this.transactions.get(downtxid)
        this._updateRemaining(downtxid, downtx)
      }
    } else {
      this.remaining.delete(txid)
      for (const downtxid of tx.downstream) {
        const downtx = this.transactions.get(downtxid)
        this._updateRemaining(downtxid, downtx)
      }
    }
  }

  _checkIfReadyToExecute (txid, tx) {
    if (tx.executed) return
    if (!tx.executable) return
    if (!tx.downloaded) return
    if (tx.upstream.size) return
    if (this.untrusted.has(txid)) return
    if (this.onReadyToExecute) this.onReadyToExecute(txid)
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Graph
