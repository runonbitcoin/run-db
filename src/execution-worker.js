class ExecutionWorker {
  constructor (indexer, execQueue, trustQueue) {
    this.indexer = indexer
    this.execQueue = execQueue
    this.trustQueue = trustQueue
    this.execSubscription = null
    this.trustSubscription = null
  }

  async setUp () {
    this.execSubscription = await this.execQueue.subscribe(async ({ txid, blockHeight }) => {
      // console.log('starting: ', txid)
      try {
        const result = await this.indexer.indexTxid(txid, blockHeight)
        await this._handleIndexResult(result)
        return { txid, success: result.executed }
      } catch (e) {
        console.warn(e)
        return { txid, success: false }
      }
    })
    this.trustSubscription = await this.trustQueue.subscribe(async ({ txid, trust }) => {
      if (trust) {
        const trusted = await this.indexer.trust(txid)
        return { trusted, untrusted: [] }
      } else {
        const untrusted = await this.indexer.untrust(txid)
        return { untrusted, trusted: [] }
      }
    })
  }

  async tearDown () {
    if (this.execSubscription !== null) {
      await this.execSubscription.cancel()
    }
    if (this.trustSubscription !== null) {
      await this.trustSubscription.cancel()
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
