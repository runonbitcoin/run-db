/**
 * executor.js
 *
 * Executes RUN transactions and calculates state
 */

const { Worker } = require('worker_threads')
const Bus = require('./bus')

// ------------------------------------------------------------------------------------------------
// Executor
// ------------------------------------------------------------------------------------------------

class Executor {
  constructor (network, numWorkers, database, logger) {
    this.network = network
    this.numWorkers = numWorkers
    this.database = database
    this.logger = logger

    this.onIndexed = null
    this.onExecuteFailed = null
    this.onMissingDeps = null

    this.workers = []
    this.workerRequests = []
    this.executing = new Set()
  }

  start () {
    for (let i = 0; i < this.numWorkers; i++) {
      this.logger.debug('Starting worker', i)

      const path = require.resolve('./worker.js')

      const worker = new Worker(path, { workerData: { id: i, network: this.network } })

      worker.id = i
      worker.available = true
      worker.missingDeps = new Set()

      this.workers.push(worker)

      const cacheGet = (txid) => this._onCacheGet(txid)
      const blockchainFetch = (txid) => this._onBlockchainFetch(worker, txid)
      const handlers = { cacheGet, blockchainFetch }

      Bus.listen(worker, handlers)

      if (this.workerRequests.length) {
        worker.available = false
        this.workerRequests.shift()(worker)
      }
    }
  }

  async stop () {
    this.logger.debug('Stopping all workers')

    await Promise.all(this.workers.map(worker => worker.terminate()))

    this.workers = []
    this.workerRequests = []
  }

  async execute (txid) {
    if (this.executing.has(txid)) return

    this.logger.debug('Enqueueing', txid, 'for execution')

    this.executing.add(txid)

    const worker = await this._requestWorker()

    worker.missingDeps = new Set()

    const hex = this.database.getTransactionHex(txid)
    const trustlist = this.database.getTrustlist()

    try {
      const result = await Bus.sendRequest(worker, 'execute', txid, hex, trustlist)

      if (this.onIndexed) this.onIndexed(txid, result)
    } catch (e) {
      if (worker.missingDeps.size) {
        if (this.onMissingDeps) this.onMissingDeps(txid, Array.from(worker.missingDeps))
      } else {
        if (this.onExecuteFailed) this.onExecuteFailed(txid, e)
      }
    } finally {
      this.executing.delete(txid)

      worker.available = true

      if (this.workerRequests.length) {
        worker.available = false
        this.workerRequests.shift()(worker)
      }
    }
  }

  _requestWorker () {
    const worker = this.workers.find(worker => worker.available)

    if (worker) {
      worker.available = false
      return worker
    }

    return new Promise((resolve, reject) => {
      this.workerRequests.push(resolve)
    })
  }

  _onCacheGet (key) {
    if (key.startsWith('jig://')) {
      const state = this.database.getJigState(key.slice('jig://'.length))
      if (state) return JSON.parse(state)
    }
    if (key.startsWith('berry://')) {
      const state = this.database.getBerryState(key.slice('berry://'.length))
      if (state) return JSON.parse(state)
    }
    if (key.startsWith('tx://')) {
      return this.database.getTransactionHex(key.slice('tx://'.length))
    }
  }

  _onBlockchainFetch (worker, txid) {
    const hex = this.database.getTransactionHex(txid)
    if (hex) return hex
    worker.missingDeps.add(txid)
    throw new Error(`Not found: ${txid}`)
  }

  _onTrustlistGet () {
    return this.database.getTrustlist()
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Executor
