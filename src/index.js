/**
 * index.js
 *
 * Entry point
 */

const Indexer = require('./indexer')
const Server = require('./server')
const {
  API, DB, NETWORK, PORT, FETCH_LIMIT, WORKERS, MATTERCLOUD_KEY, PLANARIA_TOKEN, START_HEIGHT,
  MEMPOOL_EXPIRATION, ZMQ_URL, RPC_URL
} = require('./config')
const MatterCloud = require('./mattercloud')
const Planaria = require('./planaria')
const RunConnectFetcher = require('./run-connect')
const BitcoinNodeConnection = require('./bitcoin-node-connection')
const BitcoinRpc = require('./bitcoin-rpc')
const BitcoinZmq = require('./bitcoin-zmq')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = console

let api = null
switch (API) {
  case 'mattercloud': api = new MatterCloud(MATTERCLOUD_KEY, logger); break
  case 'planaria': api = new Planaria(PLANARIA_TOKEN, logger); break
  case 'bitcoin-node':
    if (ZMQ_URL === null) {
      throw new Error('please specify ZQM_URL when using bitcoin-node API')
    }

    if (RPC_URL === null) {
      throw new Error('please specify RPC_URL when using bitcoin-node API')
    }
    api = new BitcoinNodeConnection(new BitcoinZmq(ZMQ_URL), new BitcoinRpc(RPC_URL))
    break
  case 'run': api = new RunConnectFetcher(); break
  case 'none': api = {}; break
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
