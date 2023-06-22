/**
 * run-connect.js
 *
 * Run Connect API. Currently it only supports fetches.
 */

import axios from 'axios'

// ------------------------------------------------------------------------------------------------
// RunConnectFetcher
// ------------------------------------------------------------------------------------------------

import Api from './api'

export default class RunConnectFetcher extends Api {

  network: string;

  async connect (height: number, network: string) {
    this.network = network
  }

  async disconnect() { throw new Error('not implemented') } 

  async getNextBlock() { return null } 

  async listenForMempool() { throw new Error('not implemented') } 

  async fetch (txid: string): Promise<RunFetchResult> {
    const response = await axios.get(`https://api.run.network/v1/${this.network}/tx/${txid}`)
    const hex = response.data.hex
    const height = typeof response.data.blockheight === 'number' ? response.data.blockheight : null
    const time = typeof response.data.blocktime === 'number' ? response.data.blocktime : null
    return { hex, height, time }
  }
}

// ------------------------------------------------------------------------------------------------

interface RunFetchResult {
  hex: string;
  height: number | null;
  time: number | null;
}
