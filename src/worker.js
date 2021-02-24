const { parentPort, workerData } = require('worker_threads')
const Run = require('run-sdk')
const Bus = require('./bus')

// ------------------------------------------------------------------------------------------------
// Startup
// ------------------------------------------------------------------------------------------------

const network = workerData.network

Bus.listen(parentPort, { execute })

// ------------------------------------------------------------------------------------------------
// Cache
// ------------------------------------------------------------------------------------------------

class Cache {
  constructor () {
    this.state = {}
  }

  async get (key) {
    if (key in this.state) {
      return this.state[key]
    }

    return await Bus.sendRequest(parentPort, 'cacheGet', key)
  }

  async set (key, value) {
    this.state[key] = value
  }
}

// ------------------------------------------------------------------------------------------------
// Blockchain
// ------------------------------------------------------------------------------------------------

class Blockchain {
  constructor (txid) { this.txid = txid }
  get network () { return network }
  async broadcast (hex) { return this.txid }
  async fetch (txid) { return await Bus.sendRequest(parentPort, 'blockchainFetch', txid) }
  async utxos (script) { throw new Error('not implemented: utxos') }
  async spends (txid, vout) { throw new Error('not implemented: spends') }
  async time (txid) { throw new Error('not implemented: time') }
}

// ------------------------------------------------------------------------------------------------
// execute
// ------------------------------------------------------------------------------------------------

const run = new Run()

async function execute (txid, hex) {
  const trustlist = await Bus.sendRequest(parentPort, 'trustlistGet')

  run.cache = new Cache()
  run.blockchain = new Blockchain(txid)
  run.timeout = 300000
  run.client = true
  run.preverify = false
  trustlist.forEach(txid => run.trust(txid))
  run.trust('cache')

  const tx = await run.import(hex, { txid })

  await tx.cache()

  return run.cache.state
}

// ------------------------------------------------------------------------------------------------
