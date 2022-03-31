class BlockchainApi {
  async setUp () {}
  async tearDown () {}

  async fetch (_txid, _ifNone) {
    throw new Error('subclass responsibility')
  }

  async getBlockData (_blockHash) {
    throw new Error('subclass responsibility')
  }

  async getBlockDataByHeight (_height) {
    throw new Error('subclass responsibility')
  }

  async iterateBlock (_blockHash, _fn) {
    throw new Error('subclass responsibility')
  }

  async getTip () {
    throw new Error('subclass responsibility')
  }

  onMempoolTx (_fn) {
    throw new Error('subclass responsibility')
  }

  onNewBlock (_fn) {
    throw new Error('subclass responsibility')
  }
}

module.exports = { BlockchainApi }
