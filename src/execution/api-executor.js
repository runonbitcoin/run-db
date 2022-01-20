/**
 * executor.js
 *
 * Executes RUN transactions and calculates state
 */
const fetch = require('node-fetch')
const genericPool = require('generic-pool')

class ApiExecutor {
  constructor (endpoint, trustList, network, concurrencyNumber, logger) {
    this.endpoint = endpoint
    this.trustList = trustList
    this.network = network
    this.logger = logger

    this.onIndexed = null
    this.onExecuteFailed = null

    this.executing = new Set()

    const factory = {
      create: () => ({}),
      destroy: () => {}
    }
    const opts = {
      min: 1,
      max: concurrencyNumber
    }
    this.pool = genericPool.createPool(factory, opts)
  }

  start () {

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
    const token = await this.pool.acquire()
    try {
      this.executing.add(txid)

      const trustList = await this.trustList.executionTrustList()

      const httpResponse = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          txid,
          trustList
        })
      })
      if (!httpResponse.ok) {
        await this.onExecuteFailed(txid, 'execution error') // TOOD: this should actually be a retry.
        this.executing.delete(txid)
        return
      }
      const json = await httpResponse.json()
      const { response } = json
      await this.onIndexed(txid, response)
    } catch (e) {
      await this.onExecuteFailed(txid, 'execution error') // TOOD: this should actually be a retry.
    } finally {
      this.executing.delete(txid)
      await this.pool.release(token)
    }
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = ApiExecutor
