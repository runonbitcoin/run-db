/**
 * server.js
 *
 * Express server handlers
 */

const express = require('express')
const morgan = require('morgan')

// ------------------------------------------------------------------------------------------------
// Server
// ------------------------------------------------------------------------------------------------

class Server {
  constructor (indexer, logger, port) {
    this.indexer = indexer
    this.logger = logger
    this.port = port
    this.app = null
  }

  start () {
    const app = express()

    app.use(morgan('tiny'))

    app.use(function (err, req, res, next) {
      this.logger.error(err.stack)
      res.status(500).send('Something broke!')
    })

    app.get('/jig/:location', this.getJig.bind(this))
    app.get('/berry/:location', this.getBerry.bind(this))
    app.get('/tx/:txid', this.getTx.bind(this))
    app.get('/trust/:txid?', this.getTrust.bind(this))
    app.get('/untrusted/:txid?', this.getUntrusted.bind(this))
    app.get('/status', this.getStatus.bind(this))

    app.post('/trust/:txid', this.postTrust.bind(this))
    app.post('/untrust/:txid', this.postUntrust.bind(this))
    app.post('/add/:txid', this.postAdd.bind(this))
    app.post('/remove/:txid', this.postRemove.bind(this))

    const listener = app.listen(this.port, () => {
      this.logger.info(`Listening at http://localhost:${listener.address().port}`)
    })
  }

  async getJig (req, res, next) {
    try {
      const state = this.indexer.jig(req.params.location)
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
      const state = this.indexer.berry(req.params.location)
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
      const rawtx = this.indexer.tx(req.params.txid)
      if (rawtx) {
        res.send(rawtx)
      } else {
        res.status(404).send(`Not found: ${req.params.txid}\n`)
      }
    } catch (e) { next(e) }
  }

  async getTrust (req, res, next) {
    try {
      if (req.params.txid) {
        res.json(this.indexer.trustlist.has(req.params.txid))
      } else {
        res.json(Array.from(this.indexer.trustlist))
      }
    } catch (e) { next(e) }
  }

  async getUntrusted (req, res, next) {
    try {
      const untrusted = this.indexer.untrusted(req.params.txid)
      res.send(untrusted.join('\n') + '\n')
    } catch (e) { next(e) }
  }

  async getStatus (req, res, next) {
    try {
      const status = this.indexer.status()
      res.send(status)
    } catch (e) { next(e) }
  }

  async postTrust (req, res, next) {
    try {
      this.indexer.trust(req.params.txid)
      res.send(`Trusted ${req.params.txid}\n`)
    } catch (e) { next(e) }
  }

  async postUntrust (req, res, next) {
    try {
      this.indexer.untrust(req.params.txid)
      res.send(`Untrusted ${req.params.txid}\n`)
    } catch (e) { next(e) }
  }

  async postAdd (req, res, next) {
    try {
      this.indexer.add(req.params.txid, req.query.hex)
      res.send(`Added ${req.params.txid}\n`)
    } catch (e) { next(e) }
  }

  async postRemove (req, res, next) {
    try {
      this.indexer.remove(req.params.txid)
      res.send(`Removed ${req.params.txid}\n`)
    } catch (e) { next(e) }
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Server
