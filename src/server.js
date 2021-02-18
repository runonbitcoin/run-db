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

    app.get('/add/:txid', this.add.bind(this))
    app.get('/remove/:txid', this.remove.bind(this))
    app.get('/jig/:location', this.jig.bind(this))
    app.get('/berry/:location', this.berry.bind(this))
    app.get('/tx/:txid', this.tx.bind(this))
    app.get('/trust/:txid', this.trust.bind(this))
    app.get('/untrust/:txid', this.untrust.bind(this))
    app.get('/untrusted', this.untrusted.bind(this))

    const listener = app.listen(this.port, () => {
      this.logger.info(`Listening at http://localhost:${listener.address().port}`)
    })
  }

  async add (req, res, next) {
    try {
      this.indexer.add(req.params.txid, req.query.hex)
      res.send(`Added ${req.params.txid}\n`)
    } catch (e) { next(e) }
  }

  async remove (req, res, next) {
    try {
      this.indexer.remove(req.params.txid)
      res.send(`Removed ${req.params.txid}\n`)
    } catch (e) { next(e) }
  }

  async jig (req, res, next) {
    try {
      const state = this.indexer.jig(req.params.location)
      if (state) {
        res.send(state + '\n')
      } else {
        res.status(404).send(`Not found: ${req.params.location}\n`)
      }
    } catch (e) { next(e) }
  }

  async berry (req, res, next) {
    try {
      const state = this.indexer.berry(req.params.location)
      if (state) {
        res.send(state + '\n')
      } else {
        res.status(404).send(`Not found: ${req.params.location}\n`)
      }
    } catch (e) { next(e) }
  }

  async tx (req, res, next) {
    try {
      const rawtx = this.indexer.tx(req.params.txid)
      if (rawtx) {
        res.send(rawtx + '\n')
      } else {
        res.status(404).send(`Not found: ${req.params.txid}\n`)
      }
    } catch (e) { next(e) }
  }

  async trust (req, res, next) {
    try {
      this.indexer.trust(req.params.txid)
      res.send(`Trusted ${req.params.txid}\n`)
    } catch (e) { next(e) }
  }

  async untrust (req, res, next) {
    try {
      this.indexer.untrust(req.params.txid)
      res.send(`Untrusted ${req.params.txid}\n`)
    } catch (e) { next(e) }
  }

  async untrusted (req, res, next) {
    try {
      const untrusted = this.indexer.untrusted()
      res.send(untrusted.join('\n') + '\n')
    } catch (e) { next(e) }
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Server
