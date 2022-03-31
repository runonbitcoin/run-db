class TrustAllTrustList {
  async executionTrustList (_ds) {
    return ['*']
  }

  async checkExecutability (txid, ds) {
    return ds.txidIsReadyToExecute(txid)
  }

  async trust (txid, _ds) {
    return [txid]
  }

  async untrust (_txid, _ds) {
    // do nothing
  }

  async missingTrustFor (_txid, _ds, _includeRoot) {
    return []
  }
}

module.exports = { TrustAllTrustList }
