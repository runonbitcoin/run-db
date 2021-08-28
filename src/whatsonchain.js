/**
 * api.js
 *
 * API used to get transaction data
 */

// ------------------------------------------------------------------------------------------------
// Api
// ------------------------------------------------------------------------------------------------

const axios = require('axios')
const Centrifuge = require('centrifuge')
const WebSocket = require('ws')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const RUN_0_6_FILTER = '006a0372756e0105'

class WhatsOnChain {
    constructor(apikey, logger) {
        this.logger = logger
        this.config = {
            headers: {
                'woc-api-key': apikey
            },
            timeout: 60000
        }
    }
    // Connect to the API at a particular block height and network
    async connect (height, network) {
        if (network !== 'main') throw new Error(`Network not yet supported with WhatsOnChain: ${network}`)
    }
  
    // Stop any connections
    async disconnect () {
        if (this.mempoolEvents) {
            this.mempoolEvents.close()
            this.mempoolEvents = null
        }
    }
  
    // Returns the rawtx of the txid, or throws an error
    async fetch (txid) { 
        const response = await axios.get(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/hex`, this.config)
        const detail = await axios.get(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${txid}`, this.config)
        const hex = response.data
        const height = detail.data.blockheight === 0 ? -1 : detail.data.blockheight
        const time = detail.data.blocktime === 0 ? null : detail.data.blocktime
        return { hex, height, time }
    }
  
    // Gets the next relevant block of transactions to add
    // currHash may be null
    // If there is a next block, return: { height, hash, txids, txhexs? }
    // If there is no next block yet, return null
    // If the current block passed was reorged, return { reorg: true }
    async getNextBlock (currHeight, currHash) {
        const height = currHeight + 1
        let res, txs = []
        try {
            if (height) {
                res = await axios.get(`https://api.whatsonchain.com/v1/bsv/main/block/height/${height}`, this.config)
            }
            const hash = res.data.hash
            if (!hash) { return undefined }
            const time = res.data.time
            const prevHash = res.data.previousblockhash
            if (currHash && prevHash !== currHash) return { reorg: true }
            if (res.data.tx !== undefined || res.data.tx !== null) {
                res.data.tx.forEach(tx => {
                    txs.push(tx)
                })
            }
            if (res.data.pages) {
                for (let page of res.data.pages.uri) {
                    const nes = await axios.get(`https://api.whatsonchain.com/v1/bsv/main${page}`, this.config)
                    if (nes.data) {
                        nes.data.forEach(tx => {
                            txs.push(tx)
                        })
                    }
                }
            }
            let txids = [], transactions = [], x = 0
            const mod = txs.length % 20
            const looptimes = parseInt(txs.length / 20)
            for (let i = 0; i < looptimes; i++) {
                txids = []
                for (let j = 0; j < 20; j++) {
                    txids.push(txs[x])
                    x++
                }
                const h = await axios.post('https://api.whatsonchain.com/v1/bsv/main/txs/hex', { txids }, this.config)
                if (h.data) {
                    h.data.forEach(t => {
                        if (t.hex.includes(RUN_0_6_FILTER)) {
                            transactions.push(t)
                        }
                    })
                }
            }
            txids = []
            for (let k = txs.length - 1; k > txs.length - mod; k--) {
                txids.push(txs[k])
            }
            if (txids.length) {
                const h = await axios.post('https://api.whatsonchain.com/v1/bsv/main/txs/hex', { txids }, this.config)
                if (h.data) {
                    h.data.forEach(t => {
                        if (t.hex.includes(RUN_0_6_FILTER)) {
                            transactions.push(t)
                        }
                    })
                }
            }
            txids = transactions.map(t => t.txid)
            const txhexs = transactions.map(t => t.hex)
            return { height, hash, time, txids, txhexs }
        } catch (e) {
            if (e.response && e.response.status === 404) return undefined
            throw e
        }
    }
  
    // Begins listening for mempool transactions
    // The callback should be called with txid and optionally rawtx when mempool tx is found
    // The crawler will call this after the block syncing is up-to-date.
    async listenForMempool (mempoolTxCallback) {
        this.logger.info('Listening for mempool via WhatsOnChain')
 
        return new Promise((resolve, reject) => {
            this.mempoolEvents = new Centrifuge('wss://socket.whatsonchain.com/mempool', {
                websocket: WebSocket
            })

            this.mempoolEvents.on('connect', ctx => {
                console.log('Connected with client ID ' + ctx.client + ' over ' + ctx.transport )
                resolve()
            })
            
            this.mempoolEvents.close = ctx => {
                console.log('Disconnected.')
            }
        
            this.mempoolEvents.on('error', ctx => {
                reject(ctx)
            })

            this.mempoolEvents.on('publish', message => {
                const hex = message.data.hex
                if (hex.includes(RUN_0_6_FILTER)) {
                    mempoolTxCallback(message.data.hash, hex)
                }
            })
            this.mempoolEvents.connect()
        })
    }
  }
  
  // ------------------------------------------------------------------------------------------------
  
  module.exports = WhatsOnChain