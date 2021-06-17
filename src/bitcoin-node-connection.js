/**
 * Bitcoin node
 *
 * This connection is meant to connect to a local bitcoin node that you have access to.
 */

// ------------------------------------------------------------------------------------------------
// Bitcoin Node
// ------------------------------------------------------------------------------------------------

class BitcoinNodeConnection {
  constructor (zmq, rpc) {
    this.zmq = zmq
    this.rpc = rpc
  }

  async connect (height, network) {
    console.log('connecting')
  }

  async disconnect () {
    console.log('disconnecting')
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

    const block = await this.rpc.getBlockByHeight(blockCount)

    if (currentHash && block.previousblockhash !== currentHash) {
      return { reorg: true }
    }

    // It doesn't return the txhexs.
    return {
      height: block.height,
      hash: block.hash,
      txids: block.tx
    }
  }

  async listenForMempool (mempoolTxCallback) {
    throw new Error('should be implemented')
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = BitcoinNodeConnection
