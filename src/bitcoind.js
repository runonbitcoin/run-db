/**
 * bitcoind.js
 *
 * Bitcoind node crawler
 */

// ------------------------------------------------------------------------------------------------
// Bitcoind
// ------------------------------------------------------------------------------------------------

class Bitcoind {
  constructor (rpcPort, rcpUser, rcpPass) {
    this.rpcPort = rpcPort
    this.rcpUser = rcpUser
    this.rcpPass = rcpPass
  }

  async connect (height, network) {
    throw new Error('Not implemented')
  }

  async disconnect () {
    throw new Error('Not implemented')
  }

  async fetch (txid) {
    throw new Error('Not implemented')
  }

  async getNextBlock (currHeight, currHash) {
    throw new Error('Not implemented')
  }

  async listenForMempool (mempoolTxCallback) {
    // TODO
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Bitcoind
