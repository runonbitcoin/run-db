const express = require('express')
const morgan = require('morgan')
const bodyParser = require('body-parser')
const cors = require('cors')
const { Writable } = require('stream')
const asyncHandler = require('express-async-handler')
const helmet = require('helmet')
const { ApiError } = require('./api-error')

class ApiServer {
  constructor (logger, opts = {}) {
    this.logger = logger
    this.onStop = opts.onStop || function () {}
    this.logger.debug('Starting server')
    this.listener = null
    this.onListening = null

    const app = express()
    this.app = app

    this.app.use(helmet())
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
  }

  async start (port = null) {
    this.app.use((err, req, res, next) => {
      if (this.logger) { this.logger.error(err.stack) }
      if (err instanceof ApiError) {
        res.status(err.httpCode).json({ code: err.errorCode, message: err.message, data: err.extraData })
      } else {
        res.status(500).send('Something broke!')
      }
      next()
    })

    this.port = port
    return new Promise(resolve => {
      this.listener = this.app.listen(port, () => {
        this.port = this.listener.address().port
        if (this.logger) this.logger.info(`Listening at http://localhost:${this.port}`)
        if (this.onListening) this.onListening()
        resolve()
      })
    })
  }

  async stop () {
    if (!this.listener) return
    await this.onStop()
    this.listener.close()
    this.listener = null
  }

  get (url, handler) {
    this.app.get(url, asyncHandler(handler))
  }

  post (url, handler) {
    this.app.post(url, asyncHandler(handler))
  }

  delete (url, handler) {
    this.app.delete(url, asyncHandler(handler))
  }
}

module.exports = { ApiServer }
