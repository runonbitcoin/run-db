/**
 * server.test.js
 *
 * Express server that exposes the Indexer
 */

const { ApiServer } = require('./api-server')
const { parseTxid } = require('../util/parse-txid')
const { ApiError } = require('./api-error')
const Run = require('run-sdk')
const crypto = require('crypto')
const BitcoinNodeConnection = require('../blockchain-api/bitcoin-node-connection')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const calculateScripthash = x => crypto.createHash('sha256').update(Buffer.from(x, 'hex')).digest().reverse().toString('hex')

const validateTxid = (aString) => parseTxid(
  aString,
  () => {
    throw new ApiError('wrong argument: txid', 'wrong-arguments', 400, { txid: aString })
  }
)

const blockchain = new BitcoinNodeConnection(null, null, process.env.BITCOIND_REST_URL)

// ------------------------------------------------------------------------------------------------
// Server
// ------------------------------------------------------------------------------------------------

const buildMainServer = (ds, blobs, execManager, logger) => {
  const server = new ApiServer(logger)

  server.param('txid', (req, res, next, value) => {
    req.params.txid = validateTxid(value)
    next()
  })

  server.get('/jig/:location', async (req, res) => {
    const location = req.params.location

    const state = await blobs.pullJigState(location, () => { throw new ApiError('jig not found', 'not-found', 404, { location }) })
    res.setHeader('Content-Type', 'application/json')
    res.send(state)
  })

  server.get('/berry/:location', async (req, res) => {
    const location = req.params.location
    const state = await blobs.pullJigState(location, () => { throw new ApiError('berry not found', 'not-found', 404, { location }) })

    res.setHeader('Content-Type', 'application/json')
    res.send(state)
  })

  server.get('/tx/:txid', async (req, res) => {
    const txid = req.params.txid
    const exists = await ds.txExists(txid)
    if (!exists) {
      throw new ApiError('tx not found', 'not-found', 404, { txid })
    }

    const rawTx = await blobs.pullTx(txid)
    res.set('Content-Type', 'application/octet-stream')
    res.send(rawTx)
  })

  server.get('/exec/:txid', async (req, res) => {
    console.log(req.params.txid)
    const rawTx = await blobs.pullTx(req.params.txid, () => { throw new Error('error') })
    const result = await execManager.indexTxNow(rawTx)
    res.json(result)
  })

  server.get('/time/:txid', async (req, res) => {
    const txid = req.params.txid
    const time = await ds.getTxTime(txid)
    if (time) {
      res.json({ time })
    } else {
      res.status(404).send(`Not found: ${req.params.txid}\n`)
    }
  })

  server.get('/spends/:location', async (req, res) => {
    const txid = await ds.getSpendingTxid(req.params.location)
    if (txid) {
      res.send({ txid })
    } else {
      res.status(404).send(`Not spent: ${req.params.location}\n`)
    }
  })

  server.get('/unspent', async (req, res) => {
    const cls = req.query.class
    const lock = req.query.lock
    let scripthash = req.query.scripthash
    if (req.query.address) scripthash = calculateScripthash(new Run.util.CommonLock(req.query.address).script())
    if (req.query.pubkey) scripthash = calculateScripthash(new Run.util.CommonLock(req.query.pubkey).script())

    if (cls && lock && scripthash) {
      res.json(await ds.getAllUnspentByClassOriginAndLockOriginAndScriptHash(cls, lock, scripthash))
    } else if (cls && lock) {
      res.json(await ds.getAllUnspentByClassOriginAndLockOrigin(cls, lock))
    } else if (cls && scripthash) {
      res.json(await ds.getAllUnspentByClassOriginAndScripthash(cls, scripthash))
    } else if (lock && scripthash) {
      res.json(await ds.getAllUnspentByLockOriginAndScripthash(lock, scripthash))
    } else if (scripthash) {
      res.json(await ds.getAllUnspentByScripthash(scripthash))
    } else if (lock) {
      res.json(await ds.getAllUnspentByLockOrigin(lock))
    } else if (cls) {
      res.json(await ds.getAllUnspentByClassOrigin(cls))
    } else {
      res.json(await ds.getAllUnspent())
    }
  })

  server.get('/trust/:txid', async (req, res) => {
    res.json(await ds.isTrusted(req.params.txid))
  })

  server.get('/trust', async (req, res) => {
    res.json(Array.from(await ds.searchAllTrust()))
  })

  // server.get('/ban/:txid?', async (req, res) => {
  //   if (req.params.txid) {
  //     res.json(await database.isBanned(req.params.txid))
  //   } else {
  //     res.json(Array.from(await database.getBanlist()))
  //   }
  // })

  server.get('/status', async (req, res) => {
    const status = {
      height: await ds.getCrawlHeight(),
      hash: await ds.getCrawlHash()
    }
    res.json(status)
  })

  server.post('/trust', async (req, res) => {
    const { txid, trust } = req.body
    const response = await execManager.trustTxNow(txid, trust)
    res.send({
      trusted: response.trusted,
      untrusted: response.untrusted
    })
  })

  // server.post('/ban/:txid', async (req, res) => {
  //   const txid = req.params.txid
  //   await database.ban(txid)
  //   res.send(`Banned ${req.params.txid}\n`)
  // })

  server.post('/tx', async (req, res) => {
    if (!(typeof req.body === 'string')) {
      Error('Invalid request parameters')
    }

    const buff = req.body
    const response = await execManager.indexTxNow(buff)
    res.send({ ok: response.success })
  })

  server.delete('/trust/:txid', async (req, res) => {
    const txid = req.params.txid
    await execManager.trustTxLater(txid, false)
    res.send(`Untrusted ${req.params.txid}\n`)
  })

  server.post('/exec-missing', async (req, res) => {
    const limit = req.query.limit
    const txsToExec = await ds.searchNonExecutedTxs(limit ? Number(limit) : 100)
    console.log(txsToExec)
    const queue = execManager.execQueue
    const set = execManager.executingSet
    await Promise.all(
      txsToExec.map(async txid => {
        await set.add(txid)
        await queue.publish({ txid })
      })
    )
    res.send({ ok: true })
  })

  server.post('/exec-txid/:txid', async (req, res) => {
    const txid = req.params.txid
    const queue = execManager.execQueue
    const set = execManager.executingSet
    await blobs.pullTx(txid, async () => {
      const buff = await blockchain.fetch(txid)
      await blobs.pushTx(txid, buff)
      return buff
    })
    await set.add(txid)
    await queue.publish({ txid })
    res.send({ ok: true })
  })

  // server.delete('/ban/:txid', async (req, res) => {
  //   const txid = req.params.txid
  //   await database.unban(txid)
  //   res.send(`Unbanned ${req.params.txid}\n`)
  // })

  // server.delete('/tx/:txid', async (req, res) => {
  //   const txid = req.params.txid
  //   await database.deleteTransaction(txid)
  //   res.send(`Removed ${req.params.txid}\n`)
  // })

  return server
}

module.exports = { buildMainServer }
