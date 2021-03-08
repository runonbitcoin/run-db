/**
 * run-connect.js
 *
 * Run Connect API. Currently it only supports fetches.
 */

const axios = require('axios')

// ------------------------------------------------------------------------------------------------
// RunConnectFetcher
// ------------------------------------------------------------------------------------------------

class RunConnectFetcher {
  async connect (height, network) {
    this.network = network
  }

  async fetch (txid) {
    const response = await axios.get(`https://api.run.network/v1/${this.network}/tx/${txid}`)
    const hex = response.data.hex
    const height = typeof response.data.blockheight === 'number' ? response.data.blockheight : null
    return { hex, height }
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = RunConnectFetcher
