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
    const result = await this.indexer.indexTransaction(txBuff, blockHeight)
    await this._handleIndexResult(result)
  }

  async setUp () {
    await this.execQueue.subscribe(async ({ txid }) => {
      const result = await this.indexer.indexTxid(txid)
      await this._handleIndexResult(result)
    })
  }

  async _handleIndexResult (result) {
    const enableProms = result.enables.map(async txid => {
      return this.execQueue.publish({ txid })
    })
    const depProms = result.missingDeps.map(async txid => {
      return this.execQueue.publish({ txid })
    })
    await Promise.all([...enableProms, ...depProms])
  }
}
module.exports = { ExecutionManager }
