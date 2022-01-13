class BaseTrustList {
  async executionTrustList () {
    throw new Error('subclass responsibility')
  }

  async checkExecutability (_txid) {
    throw new Error('subclass responsibility')
  }

  async trust (_txid) {
    throw new Error('subclass responsibility')
  }

  async untrust (_txid) {
    throw new Error('subclass responsibility')
  }
}

module.exports = { BaseTrustList }
