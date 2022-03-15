/**
 * index.js
 *
 * Entry point
 */

const Indexer = require('./indexer')
const {
  DB, NETWORK, FETCH_LIMIT, WORKERS, START_HEIGHT,
  MEMPOOL_EXPIRATION, DEFAULT_TRUSTLIST, DEBUG, SERVE_ONLY
} = require('./config')
const RunConnectFetcher = require('./run-connect')
const Database = require('./database')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = {}
logger.info = console.info.bind(console)
logger.warn = console.warn.bind(console)
logger.error = console.error.bind(console)
logger.debug = DEBUG ? console.debug.bind(console) : () => {}

const api = new RunConnectFetcher()

const database = new Database(DB, logger, false)

const indexer = new Indexer(database, api, NETWORK, FETCH_LIMIT, WORKERS, logger,
  START_HEIGHT, MEMPOOL_EXPIRATION, DEFAULT_TRUSTLIST)

// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------

async function main () {
  database.open()

  const promise = new Promise(resolve => {
    indexer.onIndex = (txid) => txid === '283ca82d323afa49af33832cde37f7f804e316573ca048b145887ced9fae8159' && resolve()
  })

  if (!SERVE_ONLY) {
    await indexer.start()
  }

  database.retryTx('283ca82d323afa49af33832cde37f7f804e316573ca048b145887ced9fae8159')
  await promise
  await indexer.stop()
  await database.close()
  process.exit(0)
}

// ------------------------------------------------------------------------------------------------
// shutdown
// ------------------------------------------------------------------------------------------------

async function shutdown () {
  await indexer.stop()
  await database.close()
  process.exit(0)
}

// ------------------------------------------------------------------------------------------------

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main()
