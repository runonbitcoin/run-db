/**
 * Bitcoin node
 *
 * This connection is meant to connect to a local bitcoin node that you have access to.
 */

// ------------------------------------------------------------------------------------------------
// Bitcoin Node
// ------------------------------------------------------------------------------------------------

import { bsv } from 'scrypt-ts'

const { metadata } = require('run-sdk').util

import Api from './api'

import BitcoinZmq from './bitcoin-zmq'

import BitcoinRpc from './bitcoin-rpc'

export default class BitcoinNodeConnection extends Api {

  zmq: BitcoinZmq;

  rpc: BitcoinRpc;

  constructor (zmq: BitcoinZmq, rpc: BitcoinRpc) {

    super()

    this.zmq = zmq

    this.rpc = rpc

  }

  async connect (height, network) {
    await this.zmq.connect()
  }

  async disconnect () {
    await this.zmq.disconnect()
  }

  async fetch (txid) {
    const response = await this.rpc.getRawTransaction(txid)

    return {
      hex: response.hex,
      time: response.blocktime ? response.blocktime : null,
      height: response.blockheight ? response.blockheight : -1
    }
  }

  async getNextBlock (currentHeight, currentHash) {
    const blockCount = await this.rpc.getBlockCount()

    if (blockCount === currentHeight) {
      return null
    }

    const targetBlockHeight = Number(currentHeight) + 1
    const blockData = await this.rpc.getBlockByHeight(targetBlockHeight, true)

    if (currentHash && blockData.previousblockhash !== currentHash) {
      return { reorg: true }
    }

    if (blockData.size >= 0xf000000) { // Avoids create a string longer than the limit
      return this._responsefromBlockData(blockData)
    }

    const block = this._parseBlock(
      await this.rpc.getBlockByHeight(targetBlockHeight, false),
      targetBlockHeight
    )
    return this._buildBlockResponse(block, targetBlockHeight)
  }

  async listenForMempool (mempoolTxCallback) {
    this.zmq.subscribeRawTx((txhex) => {
      const tx = new bsv.Transaction(txhex)

      if (this._isRunTx(tx.toBuffer().toString('hex'))) {
        mempoolTxCallback(tx.hash, tx.toBuffer().toString('hex'))
      }
    })
  }

  _isRunTx (rawTx) {
    try {
      metadata(rawTx)
      return true
    } catch (e) {
      return false
    }
  }

  _buildBlockResponse (block, height) {
    const runTxs = block.txs.filter(tx => this._isRunTx(tx.toBuffer().toString('hex')))
    const response = {
      height: height,
      hash: block.hash,
      txids: runTxs.map(tx => tx.hash),
      txhexs: runTxs.map(tx => tx.toBuffer().toString('hex'))
    }
    return response
  }

  _parseBlock (rpcResponse, requestedHeight) {
    const bsvBlock = new bsv.Block(Buffer.from(rpcResponse, 'hex'))

    return {
      height: requestedHeight,
      hash: bsvBlock.hash,
      previousblockhash: bsvBlock.header.prevHash,
      time: bsvBlock.header.time,
      txs: bsvBlock.transactions
    }
  }

  async _responsefromBlockData (rpcResponse) {
    const runTxs = []
    for (const txid of rpcResponse.tx) {
      const hexTx = await this.rpc.getRawTransaction(txid, false)
      if (this._isRunTx(hexTx)) {
        runTxs.push({ txid, hexTx })
      }
    }
    return {
      height: rpcResponse.height,
      hash: rpcResponse.hash,
      txids: runTxs.map(tx => tx.txid),
      txhexs: runTxs.map(tx => tx.hexTx)
    }
  }
}

