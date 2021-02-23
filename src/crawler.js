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
    this.listeningForMempool = false

    this.onCrawlError = null
    this.onCrawlBlockTransactions = null
    this.onRewindBlocks = null
    this.onMempoolTransaction = null
  }

  start (height, hash) {
    if (this.started) return

    this.started = true
    this.height = height
    this.hash = hash

    this._pollForNewBlocks()
  }

  stop () {
    this.started = false
    this.listeningForMempool = false
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
      if (!this.listeningForMempool) {
        this.api.listenForMempool(this._onMempoolRunTransaction.bind(this))
        this.listeningForMempool = true
      }
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
    if (this.onMempoolTransaction) this.onMempoolTransaction(txid, rawtx)
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Crawler
