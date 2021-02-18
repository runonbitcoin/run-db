/**
 * downloader.js
 *
 * Downloads transactions
 */

// ------------------------------------------------------------------------------------------------
// Downloader
// ------------------------------------------------------------------------------------------------

class Downloader {
  constructor (fetchFunction, network, numParallelDownloads) {
    this.onDownloadTransaction = null
    this.onFailedToDownloadTransaction = null
    this.onRetryingDownload = null

    this.fetchFunction = fetchFunction
    this.network = network
    this.numParallelDownloads = numParallelDownloads

    this.queued = new Set() // txid
    this.fetching = new Set() // txid
    this.attempts = new Map() // txid -> attempts
  }

  stop () {
    this.queued = new Set()
    this.fetching = new Set()
    this.attempts = new Map()
  }

  add (txid) {
    if (this.has(txid)) return

    if (this.fetching.size >= this.numParallelDownloads) {
      this.queued.add(txid)
      return
    }

    this._fetch(txid)
  }

  remove (txid) {
    if (!this.has(txid)) return
    this.queued.delete(txid)
    this.fetching.delete(txid)
    this.attempts.delete(txid)
  }

  has (txid) {
    return this.queued.has(txid) || this.fetching.has(txid)
  }

  remaining () {
    return this.queued.size + this.fetching.size
  }

  async _fetch (txid) {
    this.fetching.add(txid)

    try {
      const hex = await this.fetchFunction(txid, this.network)

      this._onFetchSucceed(txid, hex)
    } catch (e) {
      this._onFetchFailed(txid, e)
    } finally {
      this._fetchNextInQueue()
    }
  }

  _onFetchSucceed (txid, hex) {
    if (!this.fetching.has(txid)) return

    this.fetching.delete(txid)

    if (this.onDownloadTransaction) this.onDownloadTransaction(txid, hex)
  }

  _onFetchFailed (txid, e) {
    if (this.onFailedToDownloadTransaction) this.onFailedToDownloadTransaction(txid, e)

    this.fetching.delete(txid)

    const attempts = (this.attempts.get(txid) || 0) + 1
    const secondsToRetry = Math.pow(2, attempts)

    if (this.onRetryingDownload) this.onRetryingDownload(txid, secondsToRetry)

    this.attempts.set(txid, attempts)

    setTimeout(() => this.add(txid), secondsToRetry * 1000)
  }

  _fetchNextInQueue () {
    if (!this.queued.size) return

    const txid = this.queued.keys().next().value
    this.queued.delete(txid)

    this._fetch(txid)
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Downloader
