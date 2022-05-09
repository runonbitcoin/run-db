/**
 * run-connect.js
 *
 * Run Connect API. Currently it only supports fetches.
 */
const fetch = require('node-fetch')
const { chain } = require('stream-chain')
const { parser } = require('stream-json')
const StreamArray = require('stream-json/streamers/StreamArray')
const { io } = require('socket.io-client')

// ------------------------------------------------------------------------------------------------
// RunConnectFetcher
// ------------------------------------------------------------------------------------------------

const MAINNET_BASE_URL = 'https://api.run.network/v1/main'
const TESTNET_BASE_URL = 'https://api.run.network/v1/test'

const WEBSOCKET_URI = 'ws://api.run.network'

class RunConnectBlockchainApi {
  constructor (network, authToken, opts = {}) {
    this.network = network
    this.token = authToken
    this.baseUrl = opts.baseUrl
      ? opts.baseUrl
      : (network === 'main' ? MAINNET_BASE_URL : TESTNET_BASE_URL)
    this.wsBaseUri = opts.wsBaseUri || WEBSOCKET_URI
    this.wsPath = opts.wsPath
      ? opts.wsPath
      : (network === 'main' ? '/v1/main/socket.io' : '/v1/test/socket.io')
    this._onNewMempoolTx = async () => {}
    this._onNewBlock = async () => {}
    this.timer = null
    this.latestBlockHash = null
    this.io = null
  }

  async setUp (_height, _network) {
    const tip = await this.getTip()
    this.latestBlockHash = tip.hash
    this.timer = setInterval(async () => {
      const newTip = await this.getTip()
      if (newTip.hash !== this.latestBlockHash) {
        await this._onNewBlock(newTip.height, newTip.hash)
        this.latestBlockHash = newTip.hash
      }
    }, 1000 * 10) // every 10 segs
    this.io = io(this.wsBaseUri, { path: this.wsPath })
    return new Promise((resolve, reject) => {
      this.io.on('newRunTx', async ({ txid }) => {
        const rawTx = await this.fetch(txid)
        await this._onNewMempoolTx(rawTx)
      })

      this.io.on('connect', resolve)
      this.io.on('connect_error', reject)
    })
  }

  async tearDown () {
    clearInterval(this.timer)
    await this.io.close()
  }

  async fetch (txid) {
    const response = await fetch(`${this.baseUrl}/rawtx/${txid}`)
    return response.buffer()
  }

  async getBlockData (blockHash) {
    const response = await fetch(`${this.baseUrl}/block-data?hash=${blockHash}`)
    return response.json()
  }

  async getBlockDataByHeight (blockHeight) {
    const response = await fetch(`${this.baseUrl}/block-data?height=${blockHeight}`)
    return response.json()
  }

  async onMempoolTx (fn) {
    this._onNewMempoolTx = fn
  }

  async onNewBlock (fn) {
    this._onNewBlock = fn
  }

  async iterateBlock (blockHash, fn) {
    return new Promise((resolve, reject) => {
      return fetch(
        `${this.baseUrl}/run-confirmations?blockHash=${blockHash}`,
        {
          headers: { Authorization: this.token }
        }
      ).then(res => {
        const pipeline = chain([
          res.body,
          parser(),
          StreamArray.streamArray()
        ])
        pipeline.on('data', async (data) => {
          await fn(Buffer.from(data.value.hex, 'hex'))
        })
        pipeline.on('end', resolve)
        pipeline.on('error', (e) => {
          reject(e)
        })
      })
    })
  }

  async getTip () {
    const response = await fetch(`${this.baseUrl}/tip`)
    return response.json()
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = { RunConnectBlockchainApi }
