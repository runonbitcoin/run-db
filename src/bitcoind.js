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

  async connect (height, network) { }

  async disconnect () { }

  async fetch (txid) {
    throw new Error('Not implemented')
  }

  async getNextBlock (currHeight, currHash) {
    throw new Error('Not implemented')
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Bitcoind
