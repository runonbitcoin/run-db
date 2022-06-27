/**

 * crawler.test.js
 *
 * Generic blockchain crawler that adds and removes transactions to the db
 */
const _ = require('lodash')

class Crawler {
  constructor (execManager, api, ds, logger, opts = {}) {
    this.execManager = execManager
    this.api = api
    this.logger = logger
    this.ds = ds
    this.opts = opts
  }

  async start (startHeight) {
    const realTip = await this.api.getTip()
    let knownHeight = await this.ds.getCrawlHeight()
    if (knownHeight < startHeight) {
      this.ds.setCrawlHeight(startHeight)
      knownHeight = startHeight
    }

    while (knownHeight <= realTip.height) {
      const diffs = _.range(0, this.opts.initialBlockConcurrency || 1)
      await Promise.all(diffs.map(async (plus) => {
        const { height, hash } = await this.api.getBlockDataByHeight(knownHeight + plus)
        await this.receiveBlock(height, hash, true)
      }))
      knownHeight += diffs.length
    }

    await this.api.onMempoolTx(this._receiveTransaction.bind(this))
    await this.api.onNewBlock(this.receiveBlock.bind(this))
    await this.api.setUp()
  }

  async _receiveTransaction (buffTx, blockHeight = null) {
    return this.execManager.indexTxNow(buffTx, blockHeight)
  }

  async knownHeight () {
    if (!this._knownHeight) {
      this._knownHeight = await this.ds.getCrawlHeight()
    }
    return this._knownHeight
  }

  async _processBlock (blockHash, blockHeight) {
    const promises = new Set()
    let count = 0
    await this.api.iterateBlock(blockHash, async (rawTx) => {
      const promise = this._receiveTransaction(rawTx, blockHeight)
      promises.add(promise)
      count++
    })
    await Promise.all(promises)
    this.logger.debug(`block ${blockHeight} had ${count} txs`)
  }

  async receiveBlock (blockHeight, blockHash, onlyThis = false) {
    this.logger.debug('starting block', blockHeight)
    let currentHeight = await this.knownHeight()
    blockHeight = blockHeight || (await this.api.getBlockData(blockHash)).height
    if (onlyThis) {
      await this._processBlock(blockHash, blockHeight)
    } else {
      while (currentHeight < blockHeight) {
        currentHeight++
        const currentHash = blockHeight === currentHeight
          ? blockHash
          : await this.api.getBlockDataByHeight(currentHeight).then(block => block.hash)
        await this._processBlock(currentHash, currentHeight)
      }
    }

    this._knownHeight = currentHeight
    this.logger.debug('finishing block', blockHeight)
    await this.ds.setCrawlHash(blockHash)
    await this.ds.setCrawlHeight(blockHeight)

    // const txids = await this.ds.searchNonExecutedTxs()
    // console.log(`txids pending of execution: ${txids.length}`)
    // for (const eTxid of txids) {
    //   await this.execManager.execQueue.publish({ txid: eTxid })
    // }
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

module.exports = { Crawler }
