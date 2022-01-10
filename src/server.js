/**
 * server.js
 *
 * Express server that exposes the Indexer
 */

const express = require('express')
const morgan = require('morgan')
const bodyParser = require('body-parser')
const bsv = require('bsv')
const crypto = require('crypto')
const cors = require('cors')
const { Writable } = require('stream')
const Run = require('run-sdk')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const calculateScripthash = x => crypto.createHash('sha256').update(Buffer.from(x, 'hex')).digest().reverse().toString('hex')

// ------------------------------------------------------------------------------------------------
// Server
// ------------------------------------------------------------------------------------------------

class Server {
  constructor (database, logger, port) {
    this.database = database
    this.logger = logger
    this.port = port
    this.listener = null
    this.onListening = null
  }

  start () {
    this.logger.debug('Starting server')

    const app = express()

    let buffer = ''
    const write = (chunk, encoding, callback) => {
      buffer = buffer + chunk.toString()
      const lines = buffer.split(/\r\n|\n\r|\n|\r/)
      for (let i = 0; i < lines.length - 1; i++) {
        this.logger.info(lines[i])
      }
      buffer = lines[lines.length - 1]
      callback()
      return true
    }
    app.use(morgan('tiny', { stream: new Writable({ write }) }))

    app.use(bodyParser.text({ limit: '25mb' }))
    app.use(bodyParser.json({ limit: '10mb' }))

    app.use(cors())

    app.get('/jig/:location', this.getJig.bind(this))
    app.get('/berry/:location', this.getBerry.bind(this))
    app.get('/tx/:txid', this.getTx.bind(this))
    app.get('/time/:txid', this.getTime.bind(this))
    app.get('/spends/:location', this.getSpends.bind(this))
    app.get('/unspent', this.getUnspent.bind(this))
    app.get('/trust/:txid?', this.getTrust.bind(this))
    app.get('/ban/:txid?', this.getBan.bind(this))
    app.get('/status', this.getStatus.bind(this))

    app.post('/trust/:txid?', this.postTrust.bind(this))
    app.post('/ban/:txid', this.postBan.bind(this))
    app.post('/tx', this.postTx.bind(this))
    app.post('/tx/:txid', this.postTx.bind(this)) // Keeping this for retro compatibility.

    app.delete('/trust/:txid', this.deleteTrust.bind(this))
    app.delete('/ban/:txid', this.deleteBan.bind(this))
    app.delete('/tx/:txid', this.deleteTx.bind(this))

    app.use((err, req, res, next) => {
      if (this.logger) this.logger.error(err.stack)
      res.status(500).send('Something broke!')
    })

    this.listener = app.listen(this.port, () => {
      if (this.logger) this.logger.info(`Listening at http://localhost:${this.listener.address().port}`)
      this.port = this.listener.address().port
      if (this.onListening) this.onListening()
    })
  }

  stop () {
    if (!this.listener) return
    this.listener.close()
    this.listener = null
  }

  async getJig (req, res, next) {
    try {
      const state = this.database.getJigState(req.params.location)
      if (state) {
        res.setHeader('Content-Type', 'application/json')
        res.send(state)
      } else {
        res.status(404).send(`Not found: ${req.params.location}\n`)
      }
    } catch (e) { next(e) }
  }

  async getBerry (req, res, next) {
    try {
      const state = this.database.getBerryState(req.params.location)
      if (state) {
        res.setHeader('Content-Type', 'application/json')
        res.send(state)
      } else {
        res.status(404).send(`Not found: ${req.params.location}\n`)
      }
    } catch (e) { next(e) }
  }

  async getTx (req, res, next) {
    try {
      const txid = this._parseTxid(req.params.txid)
      const rawtx = this.database.getTransactionHex(txid)
      if (rawtx) {
        res.send(rawtx)
      } else {
        res.status(404).send(`Not found: ${req.params.txid}\n`)
      }
    } catch (e) { next(e) }
  }

  async getTime (req, res, next) {
    try {
      const txid = this._parseTxid(req.params.txid)
      const time = this.database.getTransactionTime(txid)
      if (time) {
        res.json(time)
      } else {
        res.status(404).send(`Not found: ${req.params.txid}\n`)
      }
    } catch (e) { next(e) }
  }

  async getSpends (req, res, next) {
    try {
      const txid = this.database.getSpend(req.params.location)
      if (txid) {
        res.send(txid)
      } else {
        res.status(404).send(`Not spent: ${req.params.location}\n`)
      }
    } catch (e) { next(e) }
  }

  async getUnspent (req, res, next) {
    try {
      const cls = req.query.class
      const lock = req.query.lock
      let scripthash = req.query.scripthash
      if (req.query.address) scripthash = calculateScripthash(new Run.util.CommonLock(req.query.address).script())
      if (req.query.pubkey) scripthash = calculateScripthash(new Run.util.CommonLock(req.query.pubkey).script())

      if (cls && lock && scripthash) {
        res.json(this.database.getAllUnspentByClassOriginAndLockOriginAndScripthash(cls, lock, scripthash))
      } else if (cls && lock) {
        res.json(this.database.getAllUnspentByClassOriginAndLockOrigin(cls, lock))
      } else if (cls && scripthash) {
        res.json(this.database.getAllUnspentByClassOriginAndScripthash(cls, scripthash))
      } else if (lock && scripthash) {
        res.json(this.database.getAllUnspentByLockOriginAndScripthash(lock, scripthash))
      } else if (scripthash) {
        res.json(this.database.getAllUnspentByScripthash(scripthash))
      } else if (lock) {
        res.json(this.database.getAllUnspentByLockOrigin(lock))
      } else if (cls) {
        res.json(this.database.getAllUnspentByClassOrigin(cls))
      } else {
        res.json(this.database.getAllUnspent())
      }
    } catch (e) { next(e) }
  }

  async getTrust (req, res, next) {
    try {
      if (req.params.txid) {
        res.json(this.database.isTrusted(req.params.txid))
      } else {
        res.json(Array.from(this.database.getTrustlist()))
      }
    } catch (e) { next(e) }
  }

  async getBan (req, res, next) {
    try {
      if (req.params.txid) {
        res.json(this.database.isBanned(req.params.txid))
      } else {
        res.json(Array.from(this.database.getBanlist()))
      }
    } catch (e) { next(e) }
  }

  async getStatus (req, res, next) {
    try {
      const status = {
        height: this.database.getHeight(),
        hash: this.database.getHash()
      }
      res.json(status)
    } catch (e) { next(e) }
  }

  async postTrust (req, res, next) {
    try {
      if (Array.isArray(req.body)) {
        req.body.forEach(txid => {
          txid = this._parseTxid(txid)
          this.database.trust(txid)
        })
        res.send(`Trusted ${req.body.length} transactions\n`)
      } else {
        const txid = this._parseTxid(req.params.txid)
        this.database.trust(txid)
        res.send(`Trusted ${req.params.txid}\n`)
      }
    } catch (e) { next(e) }
  }

  async postBan (req, res, next) {
    try {
      const txid = this._parseTxid(req.params.txid)
      this.database.ban(txid)
      res.send(`Banned ${req.params.txid}\n`)
    } catch (e) { next(e) }
  }

  async postTx (req, res, next) {
    try {
      if (typeof req.body !== 'string') {
        throw new Error('missing rawtx')
      }
      const hex = req.body
      const bsvtx = new bsv.Transaction(hex)

      this.database.addTransaction(bsvtx.hash, hex)
      res.send(`Added ${bsvtx.hash}\n`)
    } catch (e) { next(e) }
  }

  async deleteTrust (req, res, next) {
    try {
      const txid = this._parseTxid(req.params.txid)
      this.database.untrust(txid)
      res.send(`Untrusted ${req.params.txid}\n`)
    } catch (e) { next(e) }
  }

  async deleteBan (req, res, next) {
    try {
      const txid = this._parseTxid(req.params.txid)
      this.database.unban(txid)
      res.send(`Unbanned ${req.params.txid}\n`)
    } catch (e) { next(e) }
  }

  async deleteTx (req, res, next) {
    try {
      const txid = this._parseTxid(req.params.txid)
      this.database.deleteTransaction(txid)
      res.send(`Removed ${req.params.txid}\n`)
    } catch (e) { next(e) }
  }

  _parseTxid (txid) {
    txid = txid.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('Not a txid: ' + txid)
    return txid
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Server
