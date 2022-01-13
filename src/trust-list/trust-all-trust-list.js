class TrustAllTrustList {
  constructor (ds) {
    this.ds = ds
  }

  async executionTrustList () {
    return ['*']
  }

  async checkExecutability (txid) {
    return this.ds.txidIsReadyToExecute(txid)
  }

  async trust (txid) {
    return [txid]
  }

  async untrust (_txid) {
    // do nothing
  }
}

module.exports = { TrustAllTrustList }
