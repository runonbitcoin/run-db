class ExecutionManager {
  constructor (blobs, execQueue, trustQueue) {
    this.blobs = blobs
    this.execQueue = execQueue
    this.trustQueue = trustQueue
    this.execReplyQueue = null
    this.execRQueue = null
    this.trustRQueue = null
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
    const rQueue = await this._execReplyQueue()
    return rQueue.publishAndAwaitResponse({ txid })
  }

  async indexTxLater (txBuff, blockHeight = null) {
    const txid = await this.blobs.pushTx(null, txBuff)
    await this.execQueue.publish({ txid, blockHeight }, { repplyTo: this.execReplyQueue })
  }

  async trustTxLater (txid, trust) {
    await this.trustQueue.publish({ txid, trust })
  }

  async trustTxNow (txid, trust) {
    const rQueue = await this._trustReplyQueue()
    return rQueue.publishAndAwaitResponse({ txid, trust })
  }

  async setUp () {
    this.execReplyQueue = await this.execQueue.getReplyQueue()
  }

  async tearDown () {
    if (this.subscription !== null) {
      await this.subscription.cancel()
    }
  }

  async _execReplyQueue () {
    if (this.execRQueue === null) {
      this.execRQueue = this.execQueue.getReplyQueue()
    }
    return this.execRQueue
  }

  async _trustReplyQueue () {
    if (this.trustRQueue === null) {
      this.trustRQueue = this.trustQueue.getReplyQueue()
    }
    return this.trustRQueue
  }
}

module.exports = { ExecutionManager }
