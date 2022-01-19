const { ApiServer } = require('../http/api-server')
const genericPool = require('generic-pool')
const { Worker } = require('worker_threads')
const Bus = require('../bus')

const buildExecutionServer = (logger, count, blobStorage, workerPath, network, workerOpts = {}) => {
  const factory = {
    create: () => {
      const worker = new Worker(workerPath, { workerData: { network: network, ...workerOpts, cacheType: 'direct' } })
      Bus.listen(worker, {})
      return worker
    },

    destroy: (worker) => {
      worker.terminate()
    }
  }

  const opts = {
    max: count,
    min: 1
  }

  const pool = genericPool.createPool(factory, opts)
  const server = new ApiServer(logger, {
    onStop: async () => {
      await pool.drain()
      await pool.clear()
    }
  })

  server.post('/execute', async (req, res) => {
    const worker = await pool.acquire()
    const { txid, trustList } = req.body
    const hex = await blobStorage.pullTx(txid)
    const response = await Bus.sendRequest(worker, 'execute', txid, hex, trustList)
    pool.release(worker)
    res.json(response)
  })

  return server
}

module.exports = { buildExecutionServer }
