/**
 * indexer.test.js
 *
 * Main object that discovers, downloads, executes and stores RUN transactions
 */

const Database = require('./database')
const Downloader = require('./downloader')
const Crawler = require('./crawler')

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

class Indexer {
  constructor (database, api, executor, network, numParallelDownloads, logger, startHeight, mempoolExpiration, defaultTrustlist) {
    this.onDownload = null
    this.onFailToDownload = null
    this.onIndex = null
    this.onFailToIndex = null
    this.onBlock = null
    this.onReorg = null
    this.pendingRetries = new Map()

    this.logger = logger
    this.database = database
    this.api = api
    this.network = network
    this.startHeight = startHeight
    this.mempoolExpiration = mempoolExpiration
    this.defaultTrustlist = defaultTrustlist

    const fetchFunction = this.api.fetch ? this.api.fetch.bind(this.api) : null

    this.downloader = new Downloader(fetchFunction, numParallelDownloads)
    this.executor = executor
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
    for (const txid of this.defaultTrustlist) {
      await this.database.trust(txid)
    }

    await this.database.loadTransactionsToExecute()
    const height = await this.database.getHeight() || this.startHeight
    const hash = await this.database.getHash()
    if (this.api.connect) await this.api.connect(height, this.network)

    this.logger.debug('Loading transactions to download')
    const txsToDownload = await this.database.getTransactionsToDownload()
    txsToDownload.forEach(txid => this.downloader.add(txid))

    this.crawler.start(height, hash)
  }

  async stop () {
    this.crawler.stop()
    for (const entry of this.pendingRetries.entries()) {
      clearTimeout(entry[1])
    }
    if (this.api.disconnect) await this.api.disconnect()
    this.downloader.stop()
    await this.executor.stop()
  }

  async _onDownloadTransaction (txid, hex, height, time) {
    this.logger.info(`Downloaded ${txid} (${this.downloader.remaining()} remaining)`)
    if (!await this.database.hasTransaction(txid)) return
    if (height) { await this.database.setTransactionHeight(txid, height) }
    if (time) { await this.database.setTransactionTime(txid, time) }
    await this.database.parseAndStoreTransaction(txid, hex)
    if (this.onDownload) await this.onDownload(txid)
  }

  async _onFailedToDownloadTransaction (txid, e) {
    this.logger.error('Failed to download', txid, e.toString())
    if (this.onFailToDownload) { await this.onFailToDownload(txid) }
  }

  async _onRetryingDownload (txid, secondsToRetry) {
    this.logger.info('Retrying download', txid, 'after', secondsToRetry, 'seconds')
  }

  async _onIndexed (txid, result) {
    this.pendingRetries.delete(txid)
    if (!await this.database.hasTransaction(txid)) return // Check not re-orged
    this.logger.info(`Executed ${txid}`)
    this.database.storeExecutedTransaction(txid, result)
      .catch(console.error)
    if (this.onIndex) {
      await this.onIndex(txid)
    }
  }

  async _onExecuteFailed (txid, e, shouldRetry = false) {
    if (shouldRetry) {
      const timeout = setTimeout(() => { this._onReadyToExecute(txid) }, 10000)
      this.pendingRetries.set(txid, timeout)
    } else {
      this.pendingRetries.delete(txid)
      this.logger.error(`Failed to execute ${txid}: ${e.toString()}`)
      await this.database.setTransactionExecutionFailed(txid)
    }
    if (this.onFailToIndex) this.onFailToIndex(txid, e)
  }

  async _onReadyToExecute (txid) {
    this.executor.execute(txid)
      .catch((e) =>
        console.warn(`error executing tx ${txid}: ${e.message}`)
      )
  }

  async _onAddTransaction (txid) {
    this.logger.info('Added', txid)
  }

  async _onDeleteTransaction (txid) {
    this.logger.info('Removed', txid)
    await this.downloader.remove(txid)
  }

  async _onTrustTransaction (txid) {
    this.logger.info('Trusted', txid)
  }

  async _onUntrustTransaction (txid) {
    this.logger.info('Untrusted', txid)
  }

  async _onBanTransaction (txid) {
    this.logger.info('Banned', txid)
  }

  async _onUnbanTransaction (txid) {
    this.logger.info('Unbanned', txid)
  }

  async _onUnindexTransaction (txid) {
    this.logger.info('Unindexed', txid)
  }

  async _onRequestDownload (txid) {
    await this.downloader.add(txid)
  }

  async _onMissingDeps (txid, deptxids) {
    this.logger.debug(`Discovered ${deptxids.length} dep(s) for ${txid}`)
    await this.database.addMissingDeps(txid, deptxids)
    deptxids.forEach(deptxid => this.downloader.add(deptxid))
  }

  async _onCrawlError (e) {
    this.logger.error(`Crawl error: ${e.toString()}`)
  }

  async _onCrawlBlockTransactions (height, hash, time, txids, txhexs) {
    this.logger.info(`Crawled block ${height} for ${txids.length} transactions`)
    await this.database.addBlock(txids, txhexs, height, hash, time)
    if (this.onBlock) await this.onBlock(height)
  }

  async _onRewindBlocks (newHeight) {
    this.logger.info(`Rewinding to block ${newHeight}`)

    const txids = await this.database.getTransactionsAboveHeight(newHeight)
    // Put all transactions back into the mempool. This is better than deleting them, because
    // when we assume they will just go into a different block, we don't need to re-execute.
    // If they don't make it into a block, then they will be expired in time.
    for (const txid of txids) {
      await this.database.unconfirmTransaction(txid)
    }

    await this.database.setHeight(newHeight)
    await this.database.setHash(null)

    if (this.onReorg) this.onReorg(newHeight)
  }

  async _onMempoolTransaction (txid, hex) {
    await this.database.addTransaction(txid, hex, Database.HEIGHT_MEMPOOL, null)
  }

  async _onExpireMempoolTransactions () {
    const expirationTime = Math.round(Date.now() / 1000) - this.mempoolExpiration

    const expired = await this.database.getMempoolTransactionsBeforeTime(expirationTime)
    const deleted = new Set()
    for (const txid of expired) {
      await this.database.deleteTransaction(txid, deleted)
    }
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Indexer
