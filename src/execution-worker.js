class ExecutionWorker {
  constructor (indexer, execSet, execQueue, trustQueue, postIndexQueue) {
    this.indexer = indexer
    this.execQueue = execQueue
    this.trustQueue = trustQueue
    this.postIndexQueue = postIndexQueue
    this.execSet = execSet
    this.execSubscription = null
    this.trustSubscription = null
  }

  async setUp () {
    this.execSubscription = await this.execQueue.subscribe(async ({ txid, blockHeight, cascade = true }) => {
      const result = await this.indexer.indexTxid(txid, blockHeight)
      if (result.executed) {
        await this.execSet.remove(txid)
      }
      if (cascade) {
        await this.postIndexQueue.publish({ txid, executed: result.executed, success: result.success })
      }
      return { txid, success: result.executed }
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
}

module.exports = { ExecutionWorker }
