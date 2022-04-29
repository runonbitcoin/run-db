class TestBlockchainApi {
  constructor () {
    this._onNewMempoolTx = async () => {}
    this._onNewBlock = async () => {}
    this.blocks = []
    this.txs = new Map()
    this.mempool = []
    this.pending = new Set()
    this.closeBlock('startblock')
  }

  async fetch (txid, ifNone) {
    const tx = this.txs.get(txid)
    if (!tx) {
      return ifNone()
    }
    return tx
  }

  async getBlockData (blockHash, ifNone) {
    const blockHeight = this.blocks.findIndex(b => b.hash === blockHash)
    if (blockHeight < 0) {
      return ifNone()
    }

    return { height: blockHeight, hash: blockHash }
  }

  async getBlockDataByHeight (height) {
    return { height, hash: this.blocks[height].hash }
  }

  async iterateBlock (blockHash, fn) {
    const block = this.blocks.find(b => b.hash === blockHash)
    for (const tx of block.txs) {
      await fn(tx)
    }
  }

  async getTip () {
    const latest = this.blocks[this.blocks.length - 1]
    return { height: this.blocks.length - 1, hash: latest.hash }
  }

  onMempoolTx (fn) {
    this._onNewMempoolTx = fn
  }

  onNewBlock (fn) {
    this._onNewBlock = fn
  }

  // test

  newMempoolTx (txid, rawTx) {
    this.mempool.push(rawTx)
    this.txs.set(txid, rawTx)
    const promise = this._onNewMempoolTx(rawTx)
    this.pending.add(promise)
    promise.finally(() => this.pending.delete(promise))
  }

  closeBlock (blockHash) {
    const newBlock = {
      hash: blockHash,
      txs: this.mempool
    }
    this.blocks.push(newBlock)
    this.mempool = []
    const promise = this._onNewBlock(this.blocks.length - 1, blockHash)
    this.pending.add(promise)
    promise.finally(() => this.pending.delete(promise))
  }

  async waitForall () {
    await Promise.all(this.pending)
  }

  async setUp () {}
  async tearDown () {}
}

module.exports = { TestBlockchainApi }
