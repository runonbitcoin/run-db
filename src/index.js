/**
 * index.js
 *
 * Entry point
 */

const Indexer = require('./indexer')
const Server = require('./server')
const {
  API, DB, NETWORK, PORT, FETCH_LIMIT, WORKERS, MATTERCLOUD_KEY, PLANARIA_TOKEN, START_HEIGHT,
  MEMPOOL_EXPIRATION
} = require('./config')
const MatterCloud = require('./mattercloud')
const Planaria = require('./planaria')
const RunConnectFetcher = require('./run-connect')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = console

let api = null
switch (API) {
  case 'mattercloud': api = new MatterCloud(MATTERCLOUD_KEY, logger); break
  case 'planaria': api = new Planaria(PLANARIA_TOKEN, logger); break
  case 'none': api = new RunConnectFetcher(); break
  default: throw new Error(`Unknown API: ${API}`)
}

const indexer = new Indexer(DB, api, NETWORK, FETCH_LIMIT, WORKERS, logger,
  START_HEIGHT, MEMPOOL_EXPIRATION)

const server = new Server(indexer, logger, PORT)

// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------

async function main () {
  await indexer.start()
  server.start()
}

// ------------------------------------------------------------------------------------------------
// shutdown
// ------------------------------------------------------------------------------------------------

async function shutdown () {
  server.stop()
  await indexer.stop()
  process.exit(0)
}

// ------------------------------------------------------------------------------------------------

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main()
