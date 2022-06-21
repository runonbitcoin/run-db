class ExecutingSet {
  constructor (ds) {
    this.ds = ds
  }

  check (txid) {
    return this.ds.checkExecuting(txid)
  }

  all () {
    return this.ds.findAllExecutingTxids()
  }

  add (txid) {
    return this.ds.markTxAsExecuting(txid)
  }

  remove (txid) {
    return this.ds.removeTxFromExecuting(txid)
  }
}

module.exports = { ExecutingSet }
