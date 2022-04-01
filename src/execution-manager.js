class ExecutionManager {
  constructor (indexer, execQueue) {
    this.indexer = indexer
    this.execQueue = execQueue
  }

  /**
   *  Receives a rawtx, tries to index it and queues executions discovered during indexing.
   *
   * @param {Buffer} txBuff - tx to be indexed
   * @param {number} blockHeight - if tx confirmed in which height.
   */
  async indexTransaction (txBuff, blockHeight = null) {
    const txid = await this.indexer.blobs.pushTx(null, txBuff)
    this.execQueue.publish({ txid, blockHeight })
  }

  async setUp () {
    await this.execQueue.subscribe(async ({ txid, blockHeight }) => {
      const result = await this.indexer.indexTxid(txid, blockHeight)
      await this._handleIndexResult(result)
    })
  }

  async _handleIndexResult (result) {
    const enableProms = result.enables.map(async txid => {
      return this.execQueue.publish({ txid })
    })
    await Promise.all(enableProms)
  }
}
module.exports = { ExecutionManager }
