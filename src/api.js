/**
 * api.js
 *
 * API used to get transaction data
 */

// ------------------------------------------------------------------------------------------------
// Api
// ------------------------------------------------------------------------------------------------

class Api {
  // Connect to the API at a particular block height and network
  async connect (height, network) { }

  // Stop any connections
  async disconnect () { }

  // Returns the rawtx of the txid, or throws an error
  async fetch (txid) { throw new Error('Not implemented') }

  // Gets the next relevant block of transactions to add
  // currHash may be null
  // If there is a next block, return: { height, hash, txids, txhexs? }
  // If there is no next block yet, return null
  // If the current block passed was reorged, return { reorg: true }
  async getNextBlock (currHeight, currHash) { throw new Error('Not implemented') }

  // Begins listening for mempool transactions
  // The callback should be called with txid and optionally rawtx when mempool tx is found
  // The crawler will call this after the block syncing is up-to-date.
  async listenForMempool (mempoolTxCallback) { }
}

// ------------------------------------------------------------------------------------------------

module.exports = Api
