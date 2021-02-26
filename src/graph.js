/**
 * graph.js
 *
 * A graph of all Run transactions and their dependencies to calculate execution order.
 */

const bsv = require('bsv')
const Run = require('run-sdk')

// ------------------------------------------------------------------------------------------------
// Graph
// ------------------------------------------------------------------------------------------------

class Graph {
  constructor (database) {
    this.database = database

    this.transactions = new Map()
    this.untrusted = new Set()
    this.remaining = new Set()

    this.onReadyToExecute = null
    this.onFailedToParse = null
  }

  has (txid) {
    return this.transactions.has(txid)
  }

  add (txid, executed) {
    const tx = this.transactions.get(txid) || {}

    this.transactions.set(txid, tx)

    const downstreamUnexecuted = this.database.getDownstreamUnexecuted(txid)

    if (executed && downstreamUnexecuted.length) {
      for (const downtxid of downstreamUnexecuted) {
        const downtx = this.transactions.get(downtxid)
        this._updateRemaining(downtxid, downtx)
        this._checkIfReadyToExecute(downtxid, downtx)
      }
    }

    this._parse(txid, tx)
    this._updateRemaining(txid, tx)
    this._checkIfReadyToExecute(txid, tx)

    return tx
  }

  onDownloaded (txid) {
    const tx = this.transactions.get(txid)

    this._parse(txid, tx)
    this._updateRemaining(txid, tx)
    this._checkIfReadyToExecute(txid, tx)

    const { executable } = this.database.getTransaction(txid)
    const downstreamUnexecuted = this.database.getDownstreamUnexecuted(txid)

    if (!executable && downstreamUnexecuted.length) {
      for (const downtxid of downstreamUnexecuted) {
        const downtx = this.transactions.get(downtxid)
        this._updateRemaining(downtxid, downtx)
        this._checkIfReadyToExecute(downtxid, downtx)
      }
    }
  }

  onExecutable (txid) {
    const tx = this.transactions.get(txid)
    this._updateRemaining(txid, tx)
    this._checkIfReadyToExecute(txid, tx)
  }

  onExecuted (txid, indexed) {
    const tx = this.transactions.get(txid)
    const downstreamUnexecuted = this.database.getDownstreamUnexecuted(txid)
    for (const downtxid of downstreamUnexecuted) {
      const downtx = this.transactions.get(downtxid)
      this._checkIfReadyToExecute(downtxid, downtx)
    }
    this._updateRemaining(txid, tx)
  }

  addDep (txid, deptxid) {
    const tx = this.transactions.get(txid)
    const deptxExecuted = this.database.getTransaction(deptxid).executed
    if (!deptxExecuted) {
      this.database.addDep(deptxid, txid)
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
      for (const downtxid of this.getDownstreamUnexecuted(txid)) {
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

  _parse (txid, tx) {
    const { hex, executed, executable } = this.database.getTransaction(txid)
    if (!executable) return
    if (executed) return
    if (!hex) return

    let metadata = null
    let bsvtx = null

    try {
      metadata = Run.util.metadata(hex)
      bsvtx = new bsv.Transaction(hex)
    } catch (e) {
      if (this.onFailedToParse) this.onFailedToParse(txid)
      this.onExecuted(txid, false)
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

    this.database.transaction(() => {
      for (const deptxid of deps) {
        this.addDep(deptxid, txid)
      }
    })

    const hasCode = metadata.exec.some(cmd => cmd.op === 'DEPLOY' || cmd.op === 'UPGRADE')
    const untrusted = hasCode && !this.database.isTrusted(txid)
    if (untrusted) this.untrusted.add(txid)
  }

  _isRemaining (txid, tx) {
    const { hex, executable, executed } = this.database.getTransaction(txid)
    if (!hex) return
    if (!executable) return false
    if (executed) return false
    if (this.untrusted.has(txid)) return false
    const upstreamUnexecuted = this.database.getUpstreamUnexecuted(txid)
    for (const uptxid of upstreamUnexecuted) {
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
    const downstreamUnexecuted = this.database.getDownstreamUnexecuted(txid)
    if (newRemaining) {
      this.remaining.add(txid)
      for (const downtxid of downstreamUnexecuted) {
        const downtx = this.transactions.get(downtxid)
        this._updateRemaining(downtxid, downtx)
      }
    } else {
      this.remaining.delete(txid)
      for (const downtxid of downstreamUnexecuted) {
        const downtx = this.transactions.get(downtxid)
        this._updateRemaining(downtxid, downtx)
      }
    }
  }

  _checkIfReadyToExecute (txid, tx) {
    const { hex, executable, executed } = this.database.getTransaction(txid)
    if (executed) return
    if (!hex) return
    if (!executable) return
    const upstreamUnexecuted = this.database.getUpstreamUnexecuted(txid)
    if (upstreamUnexecuted.length) return
    if (this.untrusted.has(txid)) return
    if (this.onReadyToExecute) this.onReadyToExecute(txid)
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Graph
