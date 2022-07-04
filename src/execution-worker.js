class ExecutionWorker {
  constructor (indexer, execSet, execQueue, trustQueue) {
    this.indexer = indexer
    this.execQueue = execQueue
    this.trustQueue = trustQueue
    this.execSet = execSet
    this.execSubscription = null
    this.trustSubscription = null
  }

  async setUp () {
    this.execSubscription = await this.execQueue.subscribe(async ({ txid, blockHeight, cascade = true }) => {
      try {
        const result = await this.indexer.indexTxid(txid, blockHeight)
        if (cascade) {
          await this._handleIndexResult(result)
        }
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
    const list = Array.from(new Set([...result.unknownDeps, ...result.missingDeps, ...result.enables]))
    const newTxidsToIndex = await Promise.all(list.map(async txid => {
      return await this.execSet.check(txid) ? null : txid // We only want the ones that are not there.
    }))
      .then(list => list.filter(txid => txid))
      .then(list => [...list]) // the enable ones are always included to avoid race conditions.

    const promises = newTxidsToIndex.map(async txid => {
      await this.execSet.add(txid)
      return this.execQueue.publish({ txid })
    })

    await Promise.all(promises)
  }
}

module.exports = { ExecutionWorker }
