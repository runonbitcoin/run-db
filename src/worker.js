/**
 * worker.js
 *
 * Background worker that executes Run transactions
 */

const { parentPort, workerData } = require('worker_threads')
const bsv = require('bsv')
const crypto = require('crypto')
const Bus = require('./bus')
const Run = require('./run.node.min')

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
// scripthash
// ------------------------------------------------------------------------------------------------

const sha256 = crypto.createHash('sha256')

const scripthash = x => sha256.copy().update(Buffer.from(x, 'hex')).digest().reverse().toString('hex')

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
  const classes = jigs.map(jig => [jig.location, jig.constructor.origin])
  const creationsWithLocks = tx.outputs.filter(creation => creation.owner instanceof Run.api.Lock)
  const customLocks = creationsWithLocks.map(creation => [creation.location, creation.owner])
  const locks = customLocks.map(([location, lock]) => [location, lock.constructor.origin])
  const creationsWithoutLocks = tx.outputs.filter(creation => typeof creation.owner === 'string')
  const commonLocks = creationsWithoutLocks.map(creation => [creation.location, new Run.util.CommonLock(creation.owner)])
  const scripts = customLocks.concat(commonLocks).map(([location, lock]) => [location, lock.script()])
  const scripthashes = scripts.map(([location, script]) => [location, scripthash(script)])

  return { cache, spends, classes, locks, scripthashes }
}

// ------------------------------------------------------------------------------------------------
