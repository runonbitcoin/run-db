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

    this.transactions = new Set()
    this.untrusted = new Set()
    this.remaining = new Set()

    this.onReadyToExecute = null
    this.onFailedToParse = null
  }

  add (txid, executed) {
    const downstreamUnexecuted = this.database.getDownstreamUnexecuted(txid)

    if (executed && downstreamUnexecuted.length) {
      for (const downtxid of downstreamUnexecuted) {
        this._updateRemaining(downtxid)
        this._checkIfReadyToExecute(downtxid)
      }
    }

    this._parse(txid)
    this._updateRemaining(txid)
    this._checkIfReadyToExecute(txid)
  }

  onDownloaded (txid) {
    this._parse(txid)
    this._updateRemaining(txid)
    this._checkIfReadyToExecute(txid)
  }

  onExecuted (txid) {
    const downstreamUnexecuted = this.database.getDownstreamUnexecuted(txid)
    for (const downtxid of downstreamUnexecuted) {
      this._checkIfReadyToExecute(downtxid)
    }
    this._updateRemaining(txid)
  }

  addDep (txid, deptxid) {
    const deptxExecuted = this.database.getTransaction(deptxid).executed
    if (!deptxExecuted) {
      this.database.addDep(deptxid, txid)
      this._updateRemaining(txid)
    } else {
      this._updateRemaining(txid)
      this._checkIfReadyToExecute(txid)
    }
  }

  remove (txid) {
    this.remaining.delete(txid)
    this.untrusted.delete(txid)

    for (const downtxid of this.getDownstreamUnexecuted(txid)) {
      this._updateRemaining(downtxid)
    }
  }

  onTrust (txid) {
    if (this.untrusted.delete(txid)) {
      this._updateRemaining(txid)
      this._checkIfReadyToExecute(txid)
    }
  }

  onUntrust (txid) {
    this.untrusted.add(txid)
    this._updateRemaining(txid)
  }

  _parse (txid) {
    const { hex, executed } = this.database.getTransaction(txid)
    if (executed) return
    if (!hex) return

    let metadata = null
    let bsvtx = null

    try {
      metadata = Run.util.metadata(hex)
      bsvtx = new bsv.Transaction(hex)
    } catch (e) {
      if (this.onFailedToParse) this.onFailedToParse(txid)
      this.onExecuted(txid)
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

  _isRemaining (txid) {
    const { hex, executed } = this.database.getTransaction(txid)
    if (!hex) return
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

  _updateRemaining (txid) {
    const newRemaining = this._isRemaining(txid)
    const oldRemaining = this.remaining.has(txid)
    if (newRemaining === oldRemaining) return
    const downstreamUnexecuted = this.database.getDownstreamUnexecuted(txid)
    if (newRemaining) {
      this.remaining.add(txid)
      for (const downtxid of downstreamUnexecuted) {
        this._updateRemaining(downtxid)
      }
    } else {
      this.remaining.delete(txid)
      for (const downtxid of downstreamUnexecuted) {
        this._updateRemaining(downtxid)
      }
    }
  }

  _checkIfReadyToExecute (txid, tx) {
    const { hex, executed } = this.database.getTransaction(txid)
    if (executed) return
    if (!hex) return
    const upstreamUnexecuted = this.database.getUpstreamUnexecuted(txid)
    if (upstreamUnexecuted.length) return
    if (this.untrusted.has(txid)) return
    if (this.onReadyToExecute) this.onReadyToExecute(txid)
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Graph
