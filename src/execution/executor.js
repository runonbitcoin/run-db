/**
 * executor.js
 *
 * Executes RUN transactions and calculates state
 */
const genericPool = require('generic-pool')
const { ExecutionResult } = require('../model/execution-result')
const { WorkerThread } = require('../threading/worker-thread')
const { DepNotFound } = require('./dep-not-found')
const { txidFromLocation } = require('../util/txid-from-location')

// ------------------------------------------------------------------------------------------------
// Executor
// ------------------------------------------------------------------------------------------------

class Executor {
  constructor (network, numWorkers, blobs, _ds, logger, opts = {}) {
    this.network = network
    this.numWorkers = numWorkers
    this.blobs = blobs
    this.logger = logger
    this._timeoutMs = opts.timeout || 10 * 1000
    this.workerOpts = {
      dataApiRoot: opts.dataApiRoot || null,
      txApiRoot: opts.txApiRoot || null,
      stateApiRoot: opts.stateApiRoot || null,
      cacheProviderPath: opts.cacheProviderPath || null
    }
    this.workerEnv = opts.workerEnv || {}
    this.executing = new Set()
    this.pool = null
  }

  start () {
    const factory = {
      create: async () => {
        const path = require.resolve('../worker/worker.js')

        const cacheGet = ({ key }) => this._onCacheGet(key)
        const blockchainFetch = async ({ txid }) => this._onBlockchainFetch(txid)
        const worker = new WorkerThread(
          path,
          { network: this.network, ...this.workerOpts },
          { timeout: this._timeoutMs, env: this.workerEnv }
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
    const worker = await this.pool.acquire()
    const txBuf = await this.blobs.pullTx(txid, () => null)

    const hex = txBuf.toString('hex')

    this.executing.add(txid)
    try {
      const result = await worker.send('execute', { txid, hex, trustList })
      await this.pool.release(worker)
      return new ExecutionResult(result.success, result.missingDeps, result, result.error)
    } catch (e) {
      if (e.message === 'timeout') {
        await this.pool.destroy(worker)
        return new ExecutionResult(false, [], null, e)
      }
      await this.pool.release(worker)
      return new ExecutionResult(false, [], null, e)
    } finally {
      this.executing.delete(txid)
    }
  }

  async _onCacheGet (key) {
    const [type, identifier] = key.split('://')
    if (type === 'jig') {
      return this.blobs.pullJigState(identifier, () => { throw new DepNotFound('jig', identifier, txidFromLocation(identifier)) })
    }
    if (key.startsWith('berry://')) {
      return this.blobs.pullJigState(identifier, () => undefined)
    }
    if (key.startsWith('tx://')) {
      const buf = await this.blobs.pullTx(identifier, () => undefined)
      return buf && buf.toString('hex')
    }
  }

  async _onBlockchainFetch (txid) {
    const buff = await this.blobs.pullTx(txid, () => {
      throw new DepNotFound('tx', txid, txid)
    })
    return buff.toString('hex')
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = { Executor }
