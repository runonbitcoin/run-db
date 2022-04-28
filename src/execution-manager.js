class ExecutionManager {
  constructor (blobs, execQueue) {
    this.blobs = blobs
    this.execQueue = execQueue
    this.replyQueue = null
    this.rQueue = null
    this.subscription = null
  }

  /**
   *  Receives a rawtx, tries to index it and queues executions discovered during indexing.
   *
   * @param {Buffer} txBuff - tx to be indexed
   * @param {number} blockHeight - if tx confirmed in which height.
   */
  async indexTxNow (txBuff, blockHeight = null) {
    const txid = await this.blobs.pushTx(null, txBuff)
    const rQueue = await this._replyQueue()
    return rQueue.publishAndAwaitResponse({ txid })
  }

  async indexTxLater (txBuff, blockHeight = null) {
    const txid = await this.blobs.pushTx(null, txBuff)
    await this.execQueue.publish({ txid, blockHeight }, { repplyTo: this.replyQueue })
  }

  async setUp () {
    this.replyQueue = await this.execQueue.getReplyQueue()
  }

  async tearDown () {
    if (this.subscription !== null) {
      await this.subscription.cancel()
    }
  }

  async _replyQueue () {
    if (this.rQueue === null) {
      this.rQueue = this.execQueue.getReplyQueue()
    }
    return this.rQueue
  }
}

module.exports = { ExecutionManager }
