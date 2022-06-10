/**
 * executor.js
 *
 * Executes RUN transactions and calculates state
 */
const genericPool = require('generic-pool')
const { ExecutionResult } = require('../model/execution-result')
const { WorkerThread } = require('../threading/worker-thread')

// ------------------------------------------------------------------------------------------------
// Executor
// ------------------------------------------------------------------------------------------------

class Executor {
  constructor (network, numWorkers, blobs, _ds, logger, opts = {}) {
    this.network = network
    this.numWorkers = numWorkers
    this.blobs = blobs
    this.logger = logger
    this.workerOpts = {
      dataApiRoot: opts.dataApiRoot || null,
      txApiRoot: opts.txApiRoot || null,
      stateApiRoot: opts.stateApiRoot || null,
      cacheProviderPath: opts.cacheProviderPath || null
    }
    this.workerEnv = opts.workerEnv || {}
    this.onMissingDeps = null
    this.executing = new Set()
    this.pool = null
  }

  start () {
    const factory = {
      create: async () => {
        const path = require.resolve('../worker/worker.js')

        const cacheGet = ({ key }) => this._onCacheGet(key)
        const blockchainFetch = ({ txid }) => this._onBlockchainFetch(worker, txid)
        const worker = new WorkerThread(
          path,
          { network: this.network, ...this.workerOpts },
          { timeout: 10 * 1000, env: this.workerEnv }
        )
        await worker.setUp()
        worker.subscribe('cacheGet', cacheGet)
        worker.subscribe('blockchainFetch', blockchainFetch)
        return worker
      },
      destroy: async (worker) => {
        await worker.tearDown()
      }
    }

    const opts = {
      min: 1,
      max: this.numWorkers
    }

    this.pool = genericPool.createPool(factory, opts)
  }

  async stop () {
    await this.pool.drain()
    await this.pool.clear()
  }

  async execute (txid, trustList) {
    if (this.executing.has(txid)) return new ExecutionResult(false, [], null)

    this.logger.debug('Enqueueing', txid, 'for execution')

    const worker = await this.pool.acquire()

    worker.missingDeps = new Set()

    const txBuf = await this.blobs.pullTx(txid, () => null)

    const hex = txBuf.toString('hex')

    this.executing.add(txid)
    try {
      const result = await worker.send('execute', { txid, hex, trustList })
      return new ExecutionResult(true, [], result)
    } catch (e) {
      if (worker.missingDeps.size) {
        if (this.onMissingDeps) await this.onMissingDeps(txid, Array.from(worker.missingDeps))
        return new ExecutionResult(false, Array.from(worker.missingDeps), null)
      } else {
        return new ExecutionResult(false, [], null, e)
      }
    } finally {
      this.executing.delete(txid)
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

module.exports = { Executor }
