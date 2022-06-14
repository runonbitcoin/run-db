/**
 * worker.js
 *
 * Background worker that executes RUN transactions
 */

const crypto = require('crypto')
const Run = require('run-sdk')
const bsv = require('bsv')
const { instance, workerData } = require('../threading/parent-process')
const { DEBUG } = require('../config')
const stream = require('stream')

// ------------------------------------------------------------------------------------------------
// Startup
// ------------------------------------------------------------------------------------------------

const network = workerData.network
const cacheType = workerData.cacheType
const txApiRoot = workerData.txApiRoot
const stateApiRoot = workerData.stateApiRoot
const preserveStdout = workerData.preserveStdout || false
const preserveStdErr = workerData.preserveStdErr || false
const originalLog = console.log
const CacheProvider = require(workerData.cacheProviderPath || './parent-port-cache-provider.js')
const { RemoteError } = require('../threading/remote-error')
const { DepNotFound } = require('../execution/dep-not-found')

// Prepare console

const outConsole = global.console
const executorStdout = preserveStdout
  ? process.stdout
  : new stream.Writable({ write: (_a, _b, cb) => cb() })
const executorStdErr = preserveStdErr
  ? process.stderr
  : new stream.Writable({ write: (_a, _b, cb) => cb() })
const nullConsole = new console.Console(executorStdout, executorStdErr)
global.console = nullConsole

if (cacheType === 'direct' && (!txApiRoot || !stateApiRoot)) {
  throw new Error('missing api root for direct cache')
}

instance.subscribe('execute', execute)
instance.setUp().catch(e => { throw e })

// On Node 15+, when the Blockchain fetch method throws for missing dependencies, it causes
// and unhandled promise rejection error. However, it can't reproduce outside of Run-DB.
// This needs investigation. Perhaps it's related to the worker thread. Perhaps something else.
process.on('unhandledRejection', (e) => {
  outConsole.warn('Unhandled promise rejection', e)
})

// ------------------------------------------------------------------------------------------------
// Blockchain
// ------------------------------------------------------------------------------------------------

class Blockchain {
  constructor (txid) { this.txid = txid }
  get network () { return network }
  async broadcast (_hex) { return this.txid }
  async fetch (txid) { return await instance.send('blockchainFetch', { txid }) }
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

const cacheProvider = new CacheProvider(originalLog)
const setupCache = cacheProvider.setUp()

async function execute ({ txid, hex, trustList }) {
  await setupCache
  run.cache = await cacheProvider.get()

  run.state = new Run.plugins.LocalState()
  run.blockchain = new Blockchain(txid)
  run.timeout = 300000
  run.client = false
  run.preverify = false

  trustList.forEach(txid => run.trust(txid))
  run.trust('cache')

  try {
    const tx = await run.import(hex, { txid })
    await tx.cache()

    const cache = run.cache.newStates
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
    return { success: true, cache, classes, locks, scripthashes }
  } catch (e) {
    if (e instanceof RemoteError && e.className === DepNotFound.name) {
      return { success: false, missingDeps: [e.data.txid] }
    } else {
      return { success: false, error: e }
    }
  }
}

// ------------------------------------------------------------------------------------------------
