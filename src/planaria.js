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
    this.maxReorgDepth = 10

    this.txns = []
    this.network = null
    this.recrawlTimerId = null
    this.lastCrawlHeight = null
    this.pendingReorg = false
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
    // If we don't have that hash we're looking for next, reorg for safety
    if (currHash && !this.txns.some(txn => txn.hash === currHash)) {
      return { reorg: true }
    }

    // Notify if we've detected a reorg
    if (this.pendingReorg) {
      this.pendingReorg = false
      return { reorg: true }
    }

    // Remove all transactions that are not realistically reorg-able
    while (this.txns.length && this.txns[0].height <= currHeight - this.maxReorgDepth) {
      this.txns.shift()
    }

    let i = 0
    while (i < this.txns.length && this.txns[i].height <= currHeight) { i++ }
    if (i === this.txns.length) return null

    const block = {
      height: this.txns[i].height,
      hash: this.txns[i].hash,
      txids: []
    }

    while (i < this.txns.length && this.txns[i].height === block.height) {
      block.txids.push(this.txns[i].txid)
      i++
    }

    return block
  }

  async listenForMempool (mempoolTxCallback) {
    // TODO
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
          'blk.i': { $gt: this.lastCrawlHeight - this.maxReorgDepth }
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
          let i = 0

          res.body.on('end', () => resolve())
            .pipe(es.split())
            .pipe(es.mapSync(json => {
              if (json.length) {
                const data = JSON.parse(json)

                if (i < this.txns.length) {
                  if (data.blk.i < this.txns[i].height) {
                    return
                  }

                  if (data.blk.i === this.txns[i].height && data.blk.h === this.txns[i].hash) {
                    return
                  }

                  if (data.blk.i === this.txns[i].height && data.blk.h !== this.txns[i].hash) {
                    this.pendingReorg = true
                    this.txns = this.txns.slice(0, i)
                  }
                }

                this.txns.push({ height: data.blk.i, hash: data.blk.h, txid: data.tx.h })
                this.lastCrawlHeight = data.blk.i
                i++
              }
            }))
        })
        .catch(e => e.name === 'AbortError' ? resolve() : reject(e))
    })
  };
}

// ------------------------------------------------------------------------------------------------

module.exports = Planaria
