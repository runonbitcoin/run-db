/**
 * index.js
 *
 * Entry point
 */

import Indexer from './indexer'

const {
  DB, NETWORK, FETCH_LIMIT, WORKERS, START_HEIGHT,
  MEMPOOL_EXPIRATION, DEFAULT_TRUSTLIST, DEBUG, SERVE_ONLY
} = require('./config')

import RunConnectFetcher from './run-connect'

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

import { logger } from './logger'

import Api from './api'

import Database from './database'

const api: Api = new RunConnectFetcher()

const database: Database = new Database(DB, logger, false)

const indexer = new Indexer(database, api, NETWORK, FETCH_LIMIT, WORKERS, logger,
  START_HEIGHT, MEMPOOL_EXPIRATION, DEFAULT_TRUSTLIST)

// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------

async function main () {
  const targetTxid = process.argv[2]
  if (!targetTxid) {
    console.log('please specify a txid: "npm run retryTx <txid>"')
    process.exit(1)
  }
  console.log(`re executing tx: ${targetTxid}`)
  database.open()

  const promise = new Promise<void>(resolve => {
    indexer.onIndex = (txid) => txid === targetTxid && resolve()
  })

  if (!SERVE_ONLY) {
    await indexer.start()
  }

  database.retryTx(targetTxid)
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
