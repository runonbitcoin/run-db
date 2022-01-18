/**
 * server.test.js
 *
 * Express server that exposes the Indexer
 */

const bsv = require('bsv')
const crypto = require('crypto')
const Run = require('run-sdk')
const { ApiServer } = require('./http/api-server')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const calculateScripthash = x => crypto.createHash('sha256').update(Buffer.from(x, 'hex')).digest().reverse().toString('hex')

const parseTxid = (txid) => {
  txid = txid.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('Not a txid: ' + txid)
  return txid
}

// ------------------------------------------------------------------------------------------------
// Server
// ------------------------------------------------------------------------------------------------

const buildServer = (database, logger) => {
  const server = new ApiServer(logger)

  server.get('/jig/:location', async (req, res) => {
    const state = await database.getJigState(req.params.location)
    if (state) {
      res.setHeader('Content-Type', 'application/json')
      res.send(state)
    } else {
      res.status(404).send(`Not found: ${req.params.location}\n`)
    }
  })

  server.get('/berry/:location', async (req, res) => {
    const state = await database.getBerryState(req.params.location)
    if (state) {
      res.setHeader('Content-Type', 'application/json')
      res.send(state)
    } else {
      res.status(404).send(`Not found: ${req.params.location}\n`)
    }
  })

  server.get('/tx/:txid', async (req, res) => {
    const txid = parseTxid(req.params.txid)
    const rawTx = await database.getTransactionHex(txid)
    if (rawTx) {
      res.send(rawTx)
    } else {
      res.status(404).send(`Not found: ${req.params.txid}\n`)
    }
  })

  server.get('/time/:txid', async (req, res) => {
    const txid = parseTxid(req.params.txid)
    const time = await database.getTransactionTime(txid)
    if (time) {
      res.json(time)
    } else {
      res.status(404).send(`Not found: ${req.params.txid}\n`)
    }
  })

  server.get('/spends/:location', async (req, res, next) => {
    const txid = await database.getSpend(req.params.location)
    if (txid) {
      res.send(txid)
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
      res.json(await database.getAllUnspentByClassOriginAndLockOriginAndScripthash(cls, lock, scripthash))
    } else if (cls && lock) {
      res.json(await database.getAllUnspentByClassOriginAndLockOrigin(cls, lock))
    } else if (cls && scripthash) {
      res.json(await database.getAllUnspentByClassOriginAndScripthash(cls, scripthash))
    } else if (lock && scripthash) {
      res.json(await database.getAllUnspentByLockOriginAndScripthash(lock, scripthash))
    } else if (scripthash) {
      res.json(await database.getAllUnspentByScripthash(scripthash))
    } else if (lock) {
      res.json(await database.getAllUnspentByLockOrigin(lock))
    } else if (cls) {
      res.json(await database.getAllUnspentByClassOrigin(cls))
    } else {
      res.json(await database.getAllUnspent())
    }
  })

  server.get('/trust/:txid?', async (req, res, next) => {
    if (req.params.txid) {
      res.json(await database.isTrusted(req.params.txid))
    } else {
      res.json(Array.from(await database.getTrustlist()))
    }
  })

  server.get('/ban/:txid?', async (req, res, next) => {
    if (req.params.txid) {
      res.json(await database.isBanned(req.params.txid))
    } else {
      res.json(Array.from(await database.getBanlist()))
    }
  })

  server.get('/status', async (req, res) => {
    const status = {
      height: await database.getHeight(),
      hash: await database.getHash()
    }
    res.json(status)
  })

  server.post('/trust/:txid?', async (req, res) => {
    if (Array.isArray(req.body)) {
      for (const maybeTxid of req.body) {
        const txid = parseTxid(maybeTxid)
        await database.trust(txid)
      }
      res.send(`Trusted ${req.body.length} transactions\n`)
    } else {
      const txid = parseTxid(req.params.txid)
      await database.trust(txid)
      res.send(`Trusted ${req.params.txid}\n`)
    }
  })

  server.post('/ban/:txid', async (req, res) => {
    const txid = parseTxid(req.params.txid)
    await database.ban(txid)
    res.send(`Banned ${req.params.txid}\n`)
  })

  server.post('/tx/:txid?', async (req, res) => {
    if (!(typeof req.body === 'string')) {
      Error('Invalid request parameters')
    }

    const hex = req.body
    const bsvtx = new bsv.Transaction(hex)
    await database.addTransaction(bsvtx.hash, hex)
    res.send(`Added ${(bsvtx.hash)}\n`)
  })

  server.delete('/trust/:txid', async (req, res) => {
    const txid = parseTxid(req.params.txid)
    await database.untrust(txid)
    res.send(`Untrusted ${req.params.txid}\n`)
  })

  server.delete('/ban/:txid', async (req, res) => {
    const txid = parseTxid(req.params.txid)
    await database.unban(txid)
    res.send(`Unbanned ${req.params.txid}\n`)
  })

  server.delete('/tx/:txid', async (req, res) => {
    const txid = parseTxid(req.params.txid)
    await database.deleteTransaction(txid)
    res.send(`Removed ${req.params.txid}\n`)
  })

  return server
}

module.exports = { buildServer }
