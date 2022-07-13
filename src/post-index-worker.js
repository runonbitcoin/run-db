class PostIndexWorker {
  constructor (postIndexer, execSet, execQueue, postExecQueue, logger) {
    this.postIndexer = postIndexer
    this.execQueue = execQueue
    this.postExecQueue = postExecQueue
    this.execSet = execSet
    this.postExecSubscription = null
    this.logger = logger
  }

  async setUp () {
    this.postExecSubscription = await this.postExecQueue.subscribe(async ({ txid, executed, success }) => {
      this.logger.debug(`[${txid}] received`)
      const start = new Date()
      try {
        const result = await this.postIndexer.process(txid, executed, success)
        await this._handleResult(result)
        this.logger.debug(`[${txid}] finished. time: ${new Date().valueOf() - start.valueOf()}ms`)
        return { txid, success: result.executed }
      } catch (e) {
        console.warn(e)
        return { txid, success: false }
      }
    })
  }

  async tearDown () {
    if (this.postExecSubscription !== null) {
      await this.postExecSubscription.cancel()
    }
  }

  async _handleResult (result) {
    const list = result.deps
    const newTxidsToIndex = await Promise.all(list.map(async txid => {
      return await this.execSet.check(txid) ? null : txid // We only want the ones that are not there.
    }))
      .then(list => list.filter(txid => txid))
      .then(list => [...list, ...result.enablements]) // the enable ones are always included to avoid race conditions.

    const promises = newTxidsToIndex.map(async txid => {
      await this.execSet.add(txid)
      return this.execQueue.publish({ txid })
    })

    await Promise.all(promises)
  }
}

module.exports = { PostIndexWorker }
