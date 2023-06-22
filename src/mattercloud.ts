/**
 * mattercloud.js
 *
 * MatterCloud API
 */

import axios from 'axios'

import { bsv } from 'scrypt-ts'

import Api, { Transaction } from './api'

global.EventSource = require('eventsource')
const { default: ReconnectingEventSource } = require('reconnecting-eventsource')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const RUN_0_6_FILTER = '006a0372756e0105'

// ------------------------------------------------------------------------------------------------
// MatterCloud
// ------------------------------------------------------------------------------------------------

export default class MatterCloud extends Api {

  suffix: string;

  mempoolEvents: typeof ReconnectingEventSource;

  constructor (apiKey, logger) {
    super()

    this.suffix = apiKey ? `?api_key=${apiKey}` : ''
    this.logger = logger
    this.mempoolEvents = null
  }

  async connect (height, network) {
    if (network !== 'main') throw new Error(`Network not supported with MatterCloud: ${network}`)
  }

  async disconnect () {
    if (this.mempoolEvents) {
      this.mempoolEvents.close()
      this.mempoolEvents = null
    }
  }

  async fetch (txid): Promise<Transaction> {
    const response = await axios.get(`https://api.mattercloud.net/api/v3/main/tx/${txid}${this.suffix}`)

    const hex = response.data.rawtx
    const height = response.data.blockheight === 0 ? -1 : response.data.blockheight
    const time = response.data.blocktime === 0 ? null : response.data.blocktime

    if (typeof hex === 'undefined') throw new Error(`MatterCloud API did not return hex for ${txid}`)
    if (typeof height === 'undefined') throw new Error(`MatterCloud API did not return blockheight for ${txid}`)
    if (typeof time === 'undefined') throw new Error(`MatterCloud API did not return blocktime for ${txid}`)

    return { hex, height, time }
  }

  async getNextBlock (currHeight, currHash) {
    const height = currHeight + 1
    let hash = null

    try {
      const response = await axios.get(`https://bfs.mattercloud.io/height/${height}${this.suffix}`)
      hash = response.data.blockhash
    } catch (e) {
      if (e.response && e.response.status === 404) return undefined
      throw e
    }

    try {
      const response = await axios.get(`https://bfs.mattercloud.io/block/${hash}/tx/filter/${RUN_0_6_FILTER}${this.suffix}`)

      const prevHash = response.data.header.prevHash
      if (currHash && prevHash !== currHash) return { reorg: true }

      const txhexs = response.data.tx.map(tx => tx.raw)
      const txids = txhexs.map(hex => new bsv.Transaction(hex).hash)
      const time = response.data.header.time
      return { height, hash, time, txids, txhexs }
    } catch (e) {
      if (e.response && e.response.status === 404) return undefined
      throw e
    }
  }

  async listenForMempool (mempoolTxCallback) {
    this.logger.info('Listening for mempool via MatterCloud SSE')

    return new Promise<void>((resolve, reject) => {
      this.mempoolEvents = new ReconnectingEventSource(`https://stream.mattercloud.io/mempool?filter=${RUN_0_6_FILTER}`)

      this.mempoolEvents.onerror = (e) => reject(e)

      this.mempoolEvents.onmessage = event => {
        if (event.type === 'message') {
          const data = JSON.parse(event.data)

          if (data === 'connected') {
            resolve()
            return
          }

          mempoolTxCallback(data.h, data.raw)
        }
      }
    })
  }
}

// ------------------------------------------------------------------------------------------------

