/**
 * Bitcoin node
 *
 * This connection is meant to connect to a local bitcoin node that you have access to.
 */

// ------------------------------------------------------------------------------------------------
// Bitcoin Node
// ------------------------------------------------------------------------------------------------
const bsv = require('bsv')
const { metadata } = require('run-sdk').util

const isRunTx = (tx) => {
  try {
    metadata(tx.toBuffer().toString('hex'))
    return true
  } catch (e) {
    return false
  }
}

class BitcoinNodeConnection {
  constructor (zmq, rpc) {
    this.zmq = zmq
    this.rpc = rpc
  }

  async connect (_height, _network) {
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

    const block = await this.rpc.getBlockByHeight(Number(currentHeight) + 1)

    if (currentHash && block.previousblockhash !== currentHash) {
      return { reorg: true }
    }
    return this._buildBlockResponse(block)
  }

  async listenForMempool (mempoolTxCallback) {
    this.zmq.subscribeRawTx((txhex) => {
      const tx = bsv.Transaction(txhex)

      if (this._isRunTx(tx)) {
        mempoolTxCallback(tx.hash, tx.toBuffer().toString('hex'))
      }
    })
  }

  _isRunTx (tx) {
    return isRunTx(tx)
  }

  _buildBlockResponse (block) {
    const runTxs = block.txs.filter(this._isRunTx)
    const a = {
      height: block.height,
      hash: block.hash,
      txids: runTxs.map(tx => tx.hash),
      txhexs: runTxs.map(tx => tx.toBuffer().toString('hex'))
    }
    return a
  }
}

module.exports = BitcoinNodeConnection
