/**
 * Bitcoin node
 *
 * This connection is meant to connect to a local bitcoin node that you have access to.
 */

// ------------------------------------------------------------------------------------------------
// Bitcoin Node
// ------------------------------------------------------------------------------------------------

const bsv = require('bsv')
const { BlockchainApi } = require('./blockchain-api')
const { metadata } = require('run-sdk').util
const fetch = require('node-fetch')

class BitcoinNodeConnection extends BlockchainApi {
  constructor (zmq, rpc, url) {
    super()
    this.zmq = zmq
    this.rpc = rpc
    this.url = url
  }

  async setUp (_height, _network) {
    await this.zmq.connect()
  }

  async tearDown () {
    await this.zmq.disconnect()
  }

  async fetch (txid) {
    const response = await fetch(`${this.url}/tx/${txid}.bin`)
    return response.buffer()
  }

  async getBlockData (blockHash) {
    const response = await fetch(`${this.url}/block/${blockHash}.json`)
    return response.json()
  }

  async getBlockDataByHeight (blockHeight) {
    return await this.rpc.getBlockDataByHeight(blockHeight, false)
  }

  async onMempoolTx (fn) {
    this.zmq.subscribe('rawtx', fn)
  }

  async onNewBlock (fn) {
    this.zmq.subscribe('hashblock', (buff) => {
      fn(null, buff.toString('hex'))
    })
  }

  async iterateBlock (blockHash, fn) {
    const response = await fetch(`${this.url}/block/${blockHash}.bin`)
    const buff = await response.buffer()
    const block = new bsv.Block(buff)
    const runTxs = block.transactions.filter(tx => this._isRunTx(tx.toBuffer().toString('hex')))
    await Promise.all(runTxs.map(async tx => {
      await fn(tx.toBuffer())
    }))
  }

  async getTip () {
    const height = await this.rpc.getBlockCount()
    const hash = await this.rpc.getBlockHash(height)
    return { height, hash }
  }

  _isRunTx (hexTx) {
    try {
      metadata(hexTx)
      return true
    } catch (e) {
      return false
    }
  }
}

module.exports = BitcoinNodeConnection
