/**
 * indexer.js
 *
 * Main object that discovers, downloads, executes and stores RUN transactions
 */

const Database = require('./database')
const Downloader = require('./downloader')
const Executor = require('./executor')
const Crawler = require('./crawler')

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

class Indexer {
  constructor (database, api, network, numParallelDownloads, numParallelExecutes, logger, startHeight, mempoolExpiration, defaultTrustlist) {
    this.onDownload = null
    this.onFailToDownload = null
    this.onIndex = null
    this.onFailToIndex = null
    this.onBlock = null
    this.onReorg = null

    this.logger = logger
    this.database = database
    this.api = api
    this.network = network
    this.startHeight = startHeight
    this.mempoolExpiration = mempoolExpiration
    this.defaultTrustlist = defaultTrustlist

    const fetchFunction = this.api.fetch ? this.api.fetch.bind(this.api) : null

    this.downloader = new Downloader(fetchFunction, numParallelDownloads)
    this.executor = new Executor(network, numParallelExecutes, this.database, this.logger)
    this.crawler = new Crawler(api, this.logger)

    this.database.onReadyToExecute = this._onReadyToExecute.bind(this)
    this.database.onAddTransaction = this._onAddTransaction.bind(this)
    this.database.onDeleteTransaction = this._onDeleteTransaction.bind(this)
    this.database.onTrustTransaction = this._onTrustTransaction.bind(this)
    this.database.onUntrustTransaction = this._onUntrustTransaction.bind(this)
    this.database.onBanTransaction = this._onBanTransaction.bind(this)
    this.database.onUnbanTransaction = this._onUnbanTransaction.bind(this)
    this.database.onUnindexTransaction = this._onUnindexTransaction.bind(this)
    this.database.onRequestDownload = this._onRequestDownload.bind(this)
    this.downloader.onDownloadTransaction = this._onDownloadTransaction.bind(this)
    this.downloader.onFailedToDownloadTransaction = this._onFailedToDownloadTransaction.bind(this)
    this.downloader.onRetryingDownload = this._onRetryingDownload.bind(this)
    this.executor.onIndexed = this._onIndexed.bind(this)
    this.executor.onExecuteFailed = this._onExecuteFailed.bind(this)
    this.executor.onMissingDeps = this._onMissingDeps.bind(this)
    this.crawler.onCrawlError = this._onCrawlError.bind(this)
    this.crawler.onCrawlBlockTransactions = this._onCrawlBlockTransactions.bind(this)
    this.crawler.onRewindBlocks = this._onRewindBlocks.bind(this)
    this.crawler.onMempoolTransaction = this._onMempoolTransaction.bind(this)
    this.crawler.onExpireMempoolTransactions = this._onExpireMempoolTransactions.bind(this)
  }

  async start () {
    this.logger.debug('Starting indexer')

    this.executor.start()
    this.defaultTrustlist.forEach(txid => this.database.trust(txid))
    this.database.loadTransactionsToExecute()
    const height = this.database.getHeight() || this.startHeight
    const hash = this.database.getHash()
    if (this.api.connect) await this.api.connect(height, this.network)

    this.logger.debug('Loading transactions to download')
    this.database.getTransactionsToDownload().forEach(txid => this.downloader.add(txid))

    this.crawler.start(height, hash)
  }

  async stop () {
    this.crawler.stop()
    if (this.api.disconnect) await this.api.disconnect()
    this.downloader.stop()
    await this.executor.stop()
  }

  _onDownloadTransaction (txid, hex, height, time) {
    this.logger.info(`Downloaded ${txid} (${this.downloader.remaining()} remaining)`)
    if (!this.database.hasTransaction(txid)) return
    if (height) this.database.setTransactionHeight(txid, height)
    if (time) this.database.setTransactionTime(txid, time)
    this.database.parseAndStoreTransaction(txid, hex)
    if (this.onDownload) this.onDownload(txid)
  }

  _onFailedToDownloadTransaction (txid, e) {
    this.logger.error('Failed to download', txid, e.toString())
    if (this.onFailToDownload) this.onFailToDownload(txid)
  }

  _onRetryingDownload (txid, secondsToRetry) {
    this.logger.info('Retrying download', txid, 'after', secondsToRetry, 'seconds')
  }

  _onIndexed (txid, result) {
    if (!this.database.hasTransaction(txid)) return // Check not re-orged
    this.logger.info(`Executed ${txid}`)
    this.database.storeExecutedTransaction(txid, result)
    if (this.onIndex) this.onIndex(txid)
  }

  _onExecuteFailed (txid, e) {
    this.logger.error(`Failed to execute ${txid}: ${e.toString()}`)
    this.database.setTransactionExecutionFailed(txid)
    if (this.onFailToIndex) this.onFailToIndex(txid, e)
  }

  _onReadyToExecute (txid) {
    this.executor.execute(txid)
  }

  _onAddTransaction (txid) {
    this.logger.info('Added', txid)
  }

  _onDeleteTransaction (txid) {
    this.logger.info('Removed', txid)
    this.downloader.remove(txid)
  }

  _onTrustTransaction (txid) {
    this.logger.info('Trusted', txid)
  }

  _onUntrustTransaction (txid) {
    this.logger.info('Untrusted', txid)
  }

  _onBanTransaction (txid) {
    this.logger.info('Banned', txid)
  }

  _onUnbanTransaction (txid) {
    this.logger.info('Unbanned', txid)
  }

  _onUnindexTransaction (txid) {
    this.logger.info('Unindexed', txid)
  }

  _onRequestDownload (txid) {
    this.downloader.add(txid)
  }

  _onMissingDeps (txid, deptxids) {
    this.logger.debug(`Discovered ${deptxids.length} dep(s) for ${txid}`)
    this.database.addMissingDeps(txid, deptxids)
    deptxids.forEach(deptxid => this.downloader.add(deptxid))
  }

  _onCrawlError (e) {
    this.logger.error(`Crawl error: ${e.toString()}`)
  }

  _onCrawlBlockTransactions (height, hash, time, txids, txhexs) {
    this.logger.info(`Crawled block ${height} for ${txids.length} transactions`)
    this.database.addBlock(txids, txhexs, height, hash, time)
    if (this.onBlock) this.onBlock(height)
  }

  _onRewindBlocks (newHeight) {
    this.logger.info(`Rewinding to block ${newHeight}`)

    const txids = this.database.getTransactionsAboveHeight(newHeight)

    this.database.transaction(() => {
      // Put all transactions back into the mempool. This is better than deleting them, because
      // when we assume they will just go into a different block, we don't need to re-execute.
      // If they don't make it into a block, then they will be expired in time.
      txids.forEach(txid => this.database.unconfirmTransaction(txid))

      this.database.setHeight(newHeight)
      this.database.setHash(null)
    })

    if (this.onReorg) this.onReorg(newHeight)
  }

  _onMempoolTransaction (txid, hex) {
    this.database.addTransaction(txid, hex, Database.HEIGHT_MEMPOOL, null)
  }

  _onExpireMempoolTransactions () {
    const expirationTime = Math.round(Date.now() / 1000) - this.mempoolExpiration

    const expired = this.database.getMempoolTransactionsBeforeTime(expirationTime)
    const deleted = new Set()
    this.database.transaction(() => expired.forEach(txid => this.database.deleteTransaction(txid, deleted)))
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Indexer
