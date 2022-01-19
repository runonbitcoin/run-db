const { ApiServer } = require('../http/api-server')
const genericPool = require('generic-pool')
const { Worker } = require('worker_threads')
const Bus = require('../bus')
const { ApiError } = require('../http/api-error')
const { parseTxid } = require('../util/parse-txid')

const buildExecutionServer = (logger, count, blobStorage, workerPath, network, workerOpts = {}) => {
  const factory = {
    create: () => {
      const worker = new Worker(workerPath, { workerData: { network: network, ...workerOpts, cacheType: 'direct' } })
      Bus.listen(worker, {})
      return worker
    },

    destroy: async (worker) => {
      await worker.terminate()
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
    try {
      const { txid: rawTxid, trustList } = req.body
      if (!Array.isArray(trustList)) {
        throw new ApiError('wrong parameter: trustList', 'wrong-arguments', 400, { trustList })
      }
      const txid = parseTxid(rawTxid, () => {
        throw new ApiError(
          'wrong parameter: txid',
          'wrong-arguments',
          400,
          { txid: rawTxid }
        )
      })
      const buff = await blobStorage.pullTx(txid, () => { throw new Error('not found') })
      const hex = buff.toString('hex')
      const response = await Bus.sendRequest(worker, 'execute', txid, hex, trustList)
      res.json(response)
    } finally {
      pool.release(worker).catch(() => {})
    }
  })

  return server
}

module.exports = { buildExecutionServer }
