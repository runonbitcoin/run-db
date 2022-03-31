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

class BitcoinNodeConnection extends BlockchainApi {
  constructor (zmq, rpc) {
    super()
    this.zmq = zmq
    this.rpc = rpc
    this._onNewMempoolTx = async () => {}
    this._onNewBlock = async () => {}
  }

  async setUp (_height, _network) {
    await this.zmq.connect()
  }

  async tearDown () {
    await this.zmq.disconnect()
  }

  async fetch (txid) {
    const response = await this.rpc.getRawTransaction(txid, false)
    return Buffer.from(response, 'hex')
  }

  async getBlockData (blockHash) {
    return await this.rpc.getBlockDataByHash(blockHash, false)
  }

  async getBlockDataByHeight (blockHeight) {
    return await this.rpc.getBlockDataByHeight(blockHeight, false)
  }

  async iterateBlock (blockHash, fn) {
    const blockHex = await this.rpc.getBlockHexByHash(blockHash)
    const block = new bsv.Block(Buffer.from(blockHex, 'hex'))
    const runTxs = block.transactions.filter(tx => this._isRunTx(tx.toBuffer().toString('hex')))
    await Promise.all(runTxs.map(async tx => {
      await fn(tx.toBuffer())
    }))
    // for (const runTx of runTxs) {
    //   await fn(runTx.toBuffer())
    // }
  }

  async getTip () {
    const height = await this.rpc.getBlockCount()
    const hash = await this.rpc.getBlockHash(height)
    return { height, hash }
  }

  onMempoolTx (fn) {
    this._onNewMempoolTx = fn
  }

  onNewBlock (fn) {
    this._onNewBlock = fn
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
