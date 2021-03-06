const { parentPort, workerData } = require('worker_threads')
const Run = require('./run.node.min')
const bsv = require('bsv')
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

async function execute (txid, hex, trustlist) {
  run.cache = new Cache()
  run.blockchain = new Blockchain(txid)
  run.timeout = 300000
  run.client = false
  run.preverify = false
  trustlist.forEach(txid => run.trust(txid))
  run.trust('cache')

  const tx = await run.import(hex, { txid })

  await tx.cache()

  const cache = run.cache.state
  const bsvtx = new bsv.Transaction(hex)
  const inputs = bsvtx.inputs.slice(0, Run.util.metadata(hex).in)
  const spends = inputs.map(input => `${input.prevTxId.toString('hex')}_o${input.outputIndex}`)
  const jigs = tx.outputs.filter(creation => creation instanceof Run.Jig)
  const classes = Object.fromEntries(jigs.map(jig => [jig.location, jig.constructor.origin]))

  return { cache, spends, classes }
}

// ------------------------------------------------------------------------------------------------
