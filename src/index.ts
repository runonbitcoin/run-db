/**
 * index.ts
 *
 * Entry point
 */

const Indexer = require('./indexer')
const Server = require('./server')
const {
  API, DB, NETWORK, PORT, FETCH_LIMIT, WORKERS, MATTERCLOUD_KEY, PLANARIA_TOKEN, START_HEIGHT,
  MEMPOOL_EXPIRATION, ZMQ_URL, RPC_URL, DEFAULT_TRUSTLIST, DEBUG, SERVE_ONLY
} = require('./config')

import MatterCloud from './mattercloud'

import Planaria from './planaria'

import RunConnectFetcher from './run-connect'

import Api from './api'

import BitcoinNodeConnection from './bitcoin-node-connection'

import BitcoinRpc from './bitcoin-rpc'

import BitcoinZmq from './bitcoin-zmq'

import Database from './database'

import DirectServer from './direct-server'

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

import { logger } from './logger'
let api: Api;

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
  default: throw new Error(`Unknown API: ${API}`)
}

const readonly = !!SERVE_ONLY
const database = new Database(DB, logger, readonly)

const indexer = new Indexer(database, api, NETWORK, FETCH_LIMIT, WORKERS, logger,
  START_HEIGHT, MEMPOOL_EXPIRATION, DEFAULT_TRUSTLIST)

const server = SERVE_ONLY
  ? new Server(database, logger, PORT)
  : new DirectServer(DB, PORT, logger, database)

let started = false

// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------

async function main () {
  database.open()

  if (!SERVE_ONLY) {
    await indexer.start()
  }

  await server.start()

  started = true
}

// ------------------------------------------------------------------------------------------------
// shutdown
// ------------------------------------------------------------------------------------------------

async function shutdown () {
  if (!started) return

  logger.debug('Shutting down')

  started = false

  await server.stop()

  if (!SERVE_ONLY) {
    await indexer.stop()
  }

  await database.close()

  process.exit(0)
}

// ------------------------------------------------------------------------------------------------

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main()
