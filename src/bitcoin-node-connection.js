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

    const block = this._parseBlock(
      await this.rpc.getBlockByHeight(Number(currentHeight) + 1)
    )

    if (currentHash && block.previousblockhash !== currentHash) {
      return { reorg: true }
    }
    return this._buildBlockResponse(block)
  }

  async processNextBlock (currentHeight, currentHash, txHandler, reorgHandler) {
    const blockCount = await this.rpc.getBlockCount()

    if (blockCount === currentHeight) {
      return null
    }

    const targetHeight = Number(currentHeight) + 1
    const block = await this.rpc.getBlockByHeight(targetHeight, true)

    if (currentHash && block.previousblockhash !== currentHash) {
      return reorgHandler()
    }

    for (const txId of block.tx) {
      const hex = await this.rpc.getRawTransaction(txId, false)
      await txHandler(txId, hex, block.height, block.time)
    }
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
    try {
      metadata(tx.toBuffer().toString('hex'))
      return true
    } catch (e) {
      return false
    }
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

  _parseBlock (rpcResponse, requestedHeight) {
    const bsvBlock = new bsv.Block(Buffer.from(rpcResponse, 'hex'))

    return {
      height: requestedHeight,
      hash: bsvBlock.id.toString('hex'),
      previousblockhash: bsvBlock.header.prevHash.reverse().toString('hex'),
      time: bsvBlock.header.time,
      txs: bsvBlock.transactions
    }
  }
}

module.exports = BitcoinNodeConnection
