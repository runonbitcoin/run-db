/**
 * planaria.js
 *
 * Bitbus and Bitsocket crawler. Uses the Run API to fetch transactions.
 */

const axios = require('axios')
const fetch = require('node-fetch')
const AbortController = require('abort-controller')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const RUN_PREFIX = 'run'
const RUN_VERSION = '05'

// ------------------------------------------------------------------------------------------------
// Planaria
// ------------------------------------------------------------------------------------------------

class Planaria {
  constructor (token) {
    this.token = token
    this.abortController = new AbortController()
    this.txns = []
  }

  async connect (height, network) {
    this.network = network

    const query = {
      q: {
        find: {
          'out.s2': RUN_PREFIX,
          'out.h3': RUN_VERSION,
          'blk.i': { $gte: height }
        },
        sort: { 'blk.i': 1 },
        project: { blk: 1, 'tx.h': 1 }
      }
    }

    const headers = {
      'Content-type': 'application/json; charset=utf-8',
      token: this.token
    }

    let buffer = ''

    const options = {
      method: 'post',
      headers,
      body: JSON.stringify(query),
      signal: this.abortController.signal
    }

    await new Promise((resolve, reject) => {
      fetch('https://txo.bitbus.network/block', options).then(res => {
        if (res.error) {
          reject(res.error)
          return
        }

        res.body.on('data', data => {
          buffer += data.toString('utf8')
          const lines = buffer.split('\n')
          buffer = lines[lines.length - 1]
          for (let i = 0; i < lines.length - 1; i++) {
            const data = JSON.parse(lines[i])
            this.txns.push({ txid: data.tx.h, height: data.blk.i, hash: data.blk.h })
          }
          resolve()
        })

        res.body.on('end', () => {
          if (buffer.length) {
            const data = JSON.parse(buffer)
            this.txns.push({ txid: data.tx.h, height: data.blk.i, hash: data.blk.h })
          }
        })
      })
    })
  }

  async disconnect () {
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
}

// ------------------------------------------------------------------------------------------------

module.exports = Planaria
