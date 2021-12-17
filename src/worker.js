/**
 * worker.js
 *
 * Background worker that executes RUN transactions
 */

const { parentPort, workerData } = require('worker_threads')
const crypto = require('crypto')
const Run = require('run-sdk')
const bsv = require('bsv')
const Bus = require('./bus')
const config = require('./config')
const Database = require('./database')
const { SqliteMixedDatasource } = require('./data-sources/sqlite-mixed-datasource')
const { DEBUG } = require('./config')

// ------------------------------------------------------------------------------------------------
// Startup
// ------------------------------------------------------------------------------------------------

const network = workerData.network

Bus.listen(parentPort, { execute })

// On Node 15+, when the Blockchain fetch method throws for missing dependencies, it causes
// and unhandled promise rejection error. However, it can't reproduce outside of Run-DB.
// This needs investigation. Perhaps it's related to the worker thread. Perhaps something else.
process.on('unhandledRejection', (e) => {
  console.warn('Unhandled promise rejection', e)
})

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

class DirectCache {
  constructor (db) {
    this.db = db
    this.state = new Map()
  }

  async get (key) {
    const value = this.state[key]
    if (value) { return value }

    const [type, identifier] = key.split('://')
    if (type === 'jig') {
      const jig = await this.db.getJigState(identifier)
      this.state[key] = jig
      return jig
    } else if (type === 'tx') {
      const txHex = await this.db.getTxHex(identifier)
      this.state[key] = txHex
      return txHex
    } else if (type === 'berry') {
      const berry = await this.db.getBerryState(identifier)
      this.state[key] = berry
      return berry
    } else {
      return null
    }
  }

  async set () {

  }
}

// ------------------------------------------------------------------------------------------------
// Blockchain
// ------------------------------------------------------------------------------------------------

class Blockchain {
  constructor (txid) { this.txid = txid }
  get network () { return network }
  async broadcast (_hex) { return this.txid }
  async fetch (txid) { return await Bus.sendRequest(parentPort, 'blockchainFetch', txid) }
  async utxos (_script) { throw new Error('not implemented: utxos') }
  async spends (_txid, _vout) { throw new Error('not implemented: spends') }
  async time (_txid) { throw new Error('not implemented: time') }
}

// ------------------------------------------------------------------------------------------------
// scripthash
// ------------------------------------------------------------------------------------------------

const scripthash = x => crypto.createHash('sha256').update(Buffer.from(x, 'hex')).digest().reverse().toString('hex')

// ------------------------------------------------------------------------------------------------
// execute
// ------------------------------------------------------------------------------------------------

const run = new Run({ network, logger: null })

const logger = {}
logger.info = console.info.bind(console)
logger.warn = console.warn.bind(console)
logger.error = console.error.bind(console)
logger.debug = DEBUG ? console.debug.bind(console) : () => {}

async function execute (txid, hex, trustlist) {
  if (config.DATA_SOURCE === 'mixed') {
    const ds = new SqliteMixedDatasource(config.DB, logger, false, config.DATA_API_ROOT)
    const db = new Database(ds, logger)
    run.cache = new DirectCache(db)
  } else {
    run.cache = new Cache()
  }

  run.state = new Run.plugins.LocalState()
  run.blockchain = new Blockchain(txid)
  run.timeout = 300000
  run.client = false
  run.preverify = false

  if (config.DATA_SOURCE === 'mixed') {
    run.trust('*')
  } else {
    trustlist.forEach(txid => run.trust(txid))
  }
  run.trust('cache')

  const tx = await run.import(hex, { txid })

  await tx.cache()

  const cache = run.cache.state
  const jigs = tx.outputs.filter(creation => creation instanceof Run.Jig)
  const classes = jigs.map(jig => [jig.location, jig.constructor.origin])
  const creationsWithLocks = tx.outputs.filter(creation => creation.owner instanceof Run.api.Lock)
  const customLocks = creationsWithLocks.map(creation => [creation.location, creation.owner])
  const locks = customLocks.map(([location, lock]) => [location, lock.constructor.origin])
  const creationsWithoutLocks = tx.outputs.filter(creation => typeof creation.owner === 'string')
  const addressify = owner => owner.length >= 64 ? new bsv.PublicKey(owner).toAddress().toString() : owner
  const addresses = creationsWithoutLocks.map(creation => [creation.location, addressify(creation.owner)])
  const commonLocks = addresses.map(([location, address]) => [location, new Run.util.CommonLock(address)])
  const scripts = customLocks.concat(commonLocks).map(([location, lock]) => [location, lock.script()])
  const scripthashes = scripts.map(([location, script]) => [location, scripthash(script)])

  return { cache, classes, locks, scripthashes }
}

// ------------------------------------------------------------------------------------------------
