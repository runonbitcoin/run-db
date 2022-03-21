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
  constructor (network, numWorkers, blobs, ds, logger, opts = {}) {
    this.network = network
    this.numWorkers = numWorkers
    this.blobs = blobs
    this.ds = ds
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

  async execute (txid, trustList) {
    if (this.executing.has(txid)) return

    this.logger.debug('Enqueueing', txid, 'for execution')

    this.executing.add(txid)

    const worker = await this._requestWorker()

    worker.missingDeps = new Set()

    const txBuf = await this.blobs.pullTx(txid, () => null)
    const hex = txBuf.toString('hex')

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
    const [type, identifier] = key.split('://')
    if (type === 'jig') {
      return this.blobs.pullJigState(identifier, () => undefined)
    }
    if (key.startsWith('berry://')) {
      return this.blobs.pullJigState(identifier, () => undefined)
    }
    if (key.startsWith('tx://')) {
      return await this.blobs.pullTx(identifier, () => undefined)
    }
  }

  async _onBlockchainFetch (worker, txid) {
    const hex = await this.blobs.getTransactionHex(txid)
    if (hex) return hex
    worker.missingDeps.add(txid)
    throw new Error(`Not found: ${txid}`)
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Executor
