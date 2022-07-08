class TrustAllTrustList {
  async executionTrustList (_ds) {
    return ['*']
  }

  async trustedToExecute (_txid, _ds) {
    return true
  }

  async allTrusted (_txids, _ds) {
    return true
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
