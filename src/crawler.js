/**
 * crawler.js
 *
 * Generic blockchain crawler that adds and removes transactions to the run.db
 */

// ------------------------------------------------------------------------------------------------
// Crawler
// ------------------------------------------------------------------------------------------------

class Crawler {
  constructor (api) {
    this.api = api
    this.height = null
    this.hash = null
    this.pollForNewBlocksInterval = 10000
    this.pollForNewBlocksTimerId = null
    this.rewindCount = 10
    this.started = false

    this.listenForMempoolRunTransactions = null
    this.listenForNewBlocks = null
    this.onCrawlError = null
    this.onCrawlBlockTransactions = null
    this.onRewindBlocks = null
  }

  start (height, hash) {
    if (this.started) return

    this.started = true
    this.height = height
    this.hash = hash

    if (this.listenForMempoolRunTransactions) this.listenForMempoolRunTransactions(this._onMempoolRunTransaction.bind(this))
    if (this.listenForNewBlocks) this.listenForNewBlocks(this._onNewBlock.bind(this))

    this._pollForNewBlocks()
  }

  stop () {
    this.started = false
    clearTimeout(this.pollForNewBlocksTimerId)
    this.pollForNewBlocksTimerId = null
  }

  async _pollForNewBlocks () {
    if (!this.started) return

    try {
      await this._pollForNextBlock()
    } catch (e) {
      if (this.onCrawlError) this.onCrawlError(e)
      // Swallow, we'll retry
    }

    if (!this.started) return

    this.pollForNewBlocksTimerId = setTimeout(this._pollForNewBlocks.bind(this), this.pollForNewBlocksInterval)
  }

  async _pollForNextBlock () {
    if (!this.started) return

    const currHeight = this.height
    const currHash = this.hash

    const block = this.api.getNextBlock && await this.api.getNextBlock(currHeight, currHash)

    if (!this.started) return
    if (this.height !== currHeight) return

    if (!block || block.height <= this.height) {
      this.api.listenForMempool(this._onMempoolRunTransaction.bind(this))
      return
    }

    if (block.reorg) {
      const newHeight = this.height -= this.rewindCount
      if (this.onRewindBlocks) this.onRewindBlocks(newHeight)
      this.height = newHeight
      this.hash = null
    } else {
      if (this.onCrawlBlockTransactions) this.onCrawlBlockTransactions(block.height, block.hash, block.txids, block.txhexs)
      this.height = block.height
      this.hash = block.hash
    }

    setTimeout(() => this._pollForNextBlock(), 0)
  }

  _onMempoolRunTransaction (txid, rawtx) {
    console.log('MEMPOOL', txid, !!rawtx)
    // TODO
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Crawler
