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

  async iterateBlock (blockHash, fn) {
    const block = this.blocks.find(b => b.hash === blockHash)
    for (const tx of block.txs) {
      await fn(tx)
    }
  }

  onMempoolTx (fn) {
    this._onNewMempoolTx = fn
  }

  onNewBlock (fn) {
    this._onNewBlock = fn
  }

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
    const promise = this._onNewBlock(this.blocks.length, blockHash)
    this.pending.add(promise)
    promise.finally(() => this.pending.delete(promise))
  }

  async waitForall () {
    await Promise.all(this.pending)
  }
}

module.exports = { TestBlockchainApi }
