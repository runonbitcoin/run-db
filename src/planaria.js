/**
 * planaria.js
 *
 * Bitbus and Bitsocket crawler. Uses the Run API to fetch transactions.
 */

const axios = require('axios')
const fetch = require('node-fetch')
const AbortController = require('abort-controller')
const es = require('event-stream')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const RUN_PREFIX = 'run'
const RUN_VERSION = '05'

// ------------------------------------------------------------------------------------------------
// Planaria
// ------------------------------------------------------------------------------------------------

class Planaria {
  constructor (token, logger) {
    this.token = token
    this.logger = logger
    this.abortController = new AbortController()
    this.recrawlInterveral = 10000

    this.txns = []
    this.network = null
    this.recrawlTimerId = null
    this.lastCrawlHeight = null
  }

  async connect (height, network) {
    this.network = network
    this.lastCrawlHeight = height
    await this._recrawl()
  }

  async disconnect () {
    clearTimeout(this.recrawlTimerId)
    this.abortController.abort()
  }

  async fetch (txid) {
    // Planaria doesn't have a fetch endpoint, so we use Run Connect
    const response = await axios.get(`https://api.run.network/v1/${this.network}/tx/${txid}`)
    return response.data.hex
  }

  async getNextBlock (currHeight, currHash) {
    while (this.txns.length && this.txns[0].height <= currHeight) {
      this.txns.shift()
    }

    if (!this.txns.length) return null

    const block = {
      height: this.txns[0].height,
      hash: this.txns[0].hash,
      txids: []
    }

    while (this.txns.length && this.txns[0].height === block.height) {
      block.txids.push(this.txns[0].txid)
      this.txns.shift()
    }

    // TODO: Handle reorgs

    return block
  }

  async _recrawl () {
    const scheduleRecrawl = () => { this.recrawlTimerId = setTimeout(this._recrawl.bind(this), this.recrawlInterveral) }
    return this._crawl().then(scheduleRecrawl).catch(e => { this.logger.error(e); scheduleRecrawl() })
  }

  async _crawl () {
    this.logger.info(`Crawling BitBus from ${this.lastCrawlHeight}`)

    const query = {
      q: {
        find: {
          'out.s2': RUN_PREFIX,
          'out.h3': RUN_VERSION,
          'blk.i': { $gt: this.lastCrawlHeight }
        },
        sort: { 'blk.i': 1 },
        project: { blk: 1, 'tx.h': 1 }
      }
    }

    const headers = {
      'Content-type': 'application/json; charset=utf-8',
      token: this.token
    }

    const options = {
      method: 'post',
      headers,
      body: JSON.stringify(query),
      signal: this.abortController.signal
    }

    return new Promise((resolve, reject) => {
      fetch('https://txo.bitbus.network/block', options)
        .then(res => {
          res.body.on('end', () => resolve())
            .pipe(es.split())
            .pipe(es.mapSync(json => {
              if (json.length) {
                const data = JSON.parse(json)
                this.txns.push({ height: data.blk.i, hash: data.blk.h, txid: data.tx.h })
                this.lastCrawlHeight = data.blk.i
              }
            }))
        })
        .catch(e => e.name === 'AbortError' ? resolve() : reject(e))
    })
  };
}

// ------------------------------------------------------------------------------------------------

module.exports = Planaria
