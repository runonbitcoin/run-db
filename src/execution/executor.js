/**
 * executor.js
 *
 * Executes RUN transactions and calculates state
 */

const { Worker } = require('worker_threads')
const Bus = require('../bus')
const genericPool = require('generic-pool')
const { ExecutionResult } = require('../model/execution-result')

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

    // this.workers = []
    // this.workerRequests = []
    this.executing = new Set()
    this.pool = null
  }

  start () {
    const factory = {
      create: async () => {
        const path = require.resolve('../worker/worker.js')
        const worker = new Worker(path, { workerData: { network: this.network, ...this.workerOpts } })
        const cacheGet = (txid) => this._onCacheGet(txid)
        const blockchainFetch = (txid) => this._onBlockchainFetch(worker, txid)
        const handlers = { cacheGet, blockchainFetch }
        Bus.listen(worker, handlers)
        return worker
      },
      destroy: async (worker) => {
        await worker.terminate()
      }
    }

    const opts = {
      min: 1,
      max: this.numWorkers
    }

    this.pool = genericPool.createPool(factory, opts)
  }

  async stop () {
    this.logger.debug('Stopping all workers')
    await this.pool.drain()
    await this.pool.clear()
  }

  async execute (txid, trustList) {
    if (this.executing.has(txid)) return

    this.logger.debug('Enqueueing', txid, 'for execution')

    this.executing.add(txid)

    const worker = await this.pool.acquire()

    worker.missingDeps = new Set()

    const txBuf = await this.blobs.pullTx(txid, () => null)
    const hex = txBuf.toString('hex')

    try {
      const result = await Bus.sendRequest(worker, 'execute', [txid, hex, trustList])
      return new ExecutionResult(true, [], result)
    } catch (e) {
      if (worker.missingDeps.size) {
        if (this.onMissingDeps) await this.onMissingDeps(txid, Array.from(worker.missingDeps))
        return new ExecutionResult(false, Array.from(worker.missingDeps), null)
      } else {
        return new ExecutionResult(false, [], null)
      }
    } finally {
      this.pool.release(worker)
    }
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
      const buf = await this.blobs.pullTx(identifier, () => undefined)
      return buf && buf.toString('hex')
    }
  }

  async _onBlockchainFetch (worker, txid) {
    const buff = await this.blobs.pullTx(txid, () => {
      worker.missingDeps.add(txid)
      throw new Error(`Not found: ${txid}`)
    })
    return buff.toString('hex')
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Executor
