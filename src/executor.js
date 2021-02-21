/**
 * executor.js
 *
 * Executes Run transactions and calcualtes state
 */

const { Worker } = require('worker_threads')
const Bus = require('./bus')

// ------------------------------------------------------------------------------------------------
// Executor
// ------------------------------------------------------------------------------------------------

class Executor {
  constructor (network, numWorkers) {
    this.network = network
    this.numWorkers = numWorkers

    this.onCacheGet = null
    this.onBlockchainFetch = null
    this.onTrustlistGet = null
    this.onIndexed = null
    this.onExecuteFailed = null
    this.onMissingDeps = null

    this.workers = []
    this.workerRequests = []
    this.executing = new Set()
  }

  start () {
    for (let i = 0; i < this.numWorkers; i++) {
      const path = require.resolve('./worker.js')

      const worker = new Worker(path, { workerData: { id: i, network: this.network } })

      worker.id = i
      worker.available = true
      worker.missingDeps = new Set()

      this.workers.push(worker)

      const cacheGet = (txid) => this.onCacheGet(txid)
      const blockchainFetch = (txid) => {
        try {
          return this.onBlockchainFetch(txid)
        } catch (e) {
          worker.missingDeps.add(txid)
          throw e
        }
      }
      const trustlistGet = (txid) => this.onTrustlistGet(txid)

      const handlers = { cacheGet, blockchainFetch, trustlistGet }

      Bus.listen(worker, handlers)

      if (this.workerRequests.length) {
        worker.available = false
        this.workerRequests.shift()(worker)
      }
    }
  }

  async stop () {
    await Promise.all(this.workers.map(worker => worker.terminate()))

    this.workers = []
    this.workerRequests = []
  }

  async execute (txid, hex) {
    if (this.executing.has(txid)) return

    this.executing.add(txid)

    const worker = await this._requestWorker()

    worker.missingDeps = new Set()

    try {
      const state = await Bus.sendRequest(worker, 'execute', txid, hex)

      if (this.onIndexed) this.onIndexed(txid, state)
    } catch (e) {
      if (worker.missingDeps.size) {
        if (this.onMissingDeps) this.onMissingDeps(txid, worker.missingDeps)
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
}

// ------------------------------------------------------------------------------------------------

module.exports = Executor
