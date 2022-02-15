/**
 * executor.js
 *
 * Executes RUN transactions and calculates state
 */

const { Worker } = require('worker_threads')
const Bus = require('../bus')

// ------------------------------------------------------------------------------------------------
// Executor
// ------------------------------------------------------------------------------------------------

class Executor {
  constructor (network, numWorkers, database, logger, opts = {}) {
    this.network = network
    this.numWorkers = numWorkers
    this.database = database
    this.logger = logger
    this.workerOpts = {
      dataApiRoot: opts.dataApiRoot || null,
      txApiRoot: opts.txApiRoot || null,
      stateApiRoot: opts.stateApiRoot || null,
      cacheProviderPath: opts.cacheProviderPath || null
    }

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

      const path = require.resolve('../worker/worker.js')
      const worker = new Worker(path, { workerData: { id: i, network: this.network, ...this.workerOpts } })

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

    const hex = await this.database.getTransactionHex(txid)
    const trustList = await this.database.getTrustlist()

    let result = null
    try {
      result = await Bus.sendRequest(worker, 'execute', [txid, hex, trustList])
    } catch (e) {
      if (worker.missingDeps.size) {
        if (this.onMissingDeps) await this.onMissingDeps(txid, Array.from(worker.missingDeps))
      } else {
        if (this.onExecuteFailed) await this.onExecuteFailed(txid, e.message)
      }
    } finally {
      this.executing.delete(txid)

      worker.available = true

      if (this.workerRequests.length) {
        worker.available = false
        this.workerRequests.shift()(worker)
      }
    }
    if (this.onIndexed && result !== null) {
      await this.onIndexed(txid, result)
    }
  }

  _requestWorker () {
    const worker = this.workers.find(worker => worker.available)

    if (worker) {
      worker.available = false
      return worker
    }

    return new Promise((resolve) => {
      this.workerRequests.push(resolve)
    })
  }

  async _onCacheGet (key) {
    if (key.startsWith('jig://')) {
      const state = await this.database.getJigState(key.slice('jig://'.length))
      if (state) return state
    }
    if (key.startsWith('berry://')) {
      const state = await this.database.getBerryState(key.slice('berry://'.length))
      if (state) return state
    }
    if (key.startsWith('tx://')) {
      return await this.database.getTransactionHex(key.slice('tx://'.length))
    }
  }

  async _onBlockchainFetch (worker, txid) {
    const hex = await this.database.getTransactionHex(txid)
    if (hex) return hex
    worker.missingDeps.add(txid)
    throw new Error(`Not found: ${txid}`)
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Executor
