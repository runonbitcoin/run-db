class ExecutionWorker {
  constructor (indexer, execQueue) {
    this.indexer = indexer
    this.execQueue = execQueue
    this.subscription = null
  }

  async setUp () {
    this.subscription = await this.execQueue.subscribe(async ({ txid, blockHeight }) => {
      const result = await this.indexer.indexTxid(txid, blockHeight)
      await this._handleIndexResult(result)
      return { txid }
    })
  }

  async tearDown () {
    if (this.subscription !== null) {
      await this.subscription.cancel()
    }
  }

  async _handleIndexResult (result) {
    const enableProms = result.enables.map(async txid => {
      return this.execQueue.publish({ txid })
    })
    const unknownDepsProms = result.unknownDeps.map(async txid => {
      return this.execQueue.publish({ txid })
    })
    await Promise.all([...enableProms, ...unknownDepsProms])
  }
}

module.exports = { ExecutionWorker }
