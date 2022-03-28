class BlockchainApi {
  async fetch (_txid, _ifNone) {
    throw new Error('subclass responsibility')
  }

  async iterateBlock (_blockHash, _fn) {
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
