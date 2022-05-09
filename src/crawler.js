/**
 * crawler.test.js
 *
 * Generic blockchain crawler that adds and removes transactions to the db
 */

// ------------------------------------------------------------------------------------------------
// Crawler
// ------------------------------------------------------------------------------------------------

class Crawler {
  constructor (exexManager, api, ds, logger) {
    this.execManager = exexManager
    this.api = api
    this.logger = logger
    this.ds = ds
  }

  async start (startHeight) {
    const realTip = await this.api.getTip()
    let knownHeight = await this.ds.getCrawlHeight()
    if (knownHeight < startHeight) {
      this.ds.setCrawlHeight(startHeight - 1)
      knownHeight = startHeight - 1
    }

    while (knownHeight < realTip.height) {
      knownHeight++

      const { height, hash } = await this.api.getBlockDataByHeight(knownHeight)
      await this.receiveBlock(height, hash)
    }

    await this.api.onMempoolTx(this._receiveTransaction.bind(this))
    await this.api.onNewBlock(this.receiveBlock.bind(this))
    await this.api.setUp()
  }

  async _receiveTransaction (rawTx, blockHeight = null) {
    return this.execManager.indexTxNow(rawTx, blockHeight)
  }

  async knownHeight () {
    if (!this._knownHeight) {
      this._knownHeight = await this.ds.getCrawlHeight()
    }
    return this._knownHeight
  }

  async receiveBlock (blockHeight, blockHash) {
    this.logger.debug('starting block', blockHeight)
    let currentHeight = await this.knownHeight()
    blockHeight = blockHeight || (await this.api.getBlockData(blockHash)).height
    while (currentHeight < blockHeight) {
      currentHeight++
      const currentHash = blockHeight === currentHeight
        ? blockHash
        : await this.api.getBlockDataByHeight(currentHeight).then(block => block.hash)

      const promises = new Set()
      await this.api.iterateBlock(currentHash, async (rawTx) => {
        const promise = this._receiveTransaction(rawTx, blockHeight)
        promises.add(promise)
      })
      await Promise.all(promises)
    }
    this._knownHeight = currentHeight
    this.logger.debug('finishing block', blockHeight)
    await this.ds.setCrawlHash(blockHash)
    await this.ds.setCrawlHeight(blockHeight)
  }

  async setTip (blockHash) {
    const { height, hash } = await this.api.getBlockData(blockHash)
    await this.ds.setCrawlHash(hash)
    await this.ds.setCrawlHeight(height)
  }

  async stop () {
    await this.api.tearDown()
  }

  async _expireMempoolTransactions () {
    // if (!this.started) return
    //
    // this.logger.debug('Expiring mempool transactions')
    //
    // if (this.onExpireMempoolTransactions) { await this.onExpireMempoolTransactions() }
    //
    // this.expireMempoolTransactionsTimerId = setTimeout(
    //   this._expireMempoolTransactions.bind(this), this.expireMempoolTransactionsInterval)
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Crawler
