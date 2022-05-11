/**
 * index.js
 *
 * Entry point
 */

const ampq = require('amqplib')
const {
  ZMQ_URL,
  RPC_URL,
  RABBITMQ_URI,
  BITCOIND_REST_URL,
  BLOB_DB_CONNECTION_URI,
  MAIN_DB_CONNECTION_URI,
  INITIAL_CRAWL_HEIGHT,
  NETWORK,
  CRAWLER_IMPLEMENTATION
} = require('../config')

const { KnexDatasource } = require('../data-sources/knex-datasource')
const knex = require('knex')
const { Crawler, BitcoinNodeConnection, BitcoinZmq, BitcoinRpc } = require('../index')
const { KnexBlobStorage } = require('../data-sources/knex-blob-storage')
const { ExecutionManager } = require('../execution-manager')
const { RabbitQueue } = require('../queues/rabbit-queue')
const path = require('path')
const { RunConnectBlockchainApi } = require('../blockchain-api/run-connect')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = console

let api
if (CRAWLER_IMPLEMENTATION === 'bitcoin-node') {
  const zmq = new BitcoinZmq(ZMQ_URL)
  const rpc = new BitcoinRpc(RPC_URL)
  api = new BitcoinNodeConnection(zmq, rpc, BITCOIND_REST_URL)
} else {
  api = new RunConnectBlockchainApi(NETWORK, '87400211a0a6712a688d5b10b854f0105cc114a1bd53285adfb4dde6d3968983', {
    excludeApps: ['cryptofights', 'fyx']
    // baseUrl: 'http://localhost:3000/v1/test',
    // wsBaseUri: 'ws://localhost:3003',
    // wsPath: '/ws/socket.io'
  })
}

const knexInstance = knex({
  client: 'pg',
  connection: MAIN_DB_CONNECTION_URI,
  migrations: {
    tableName: 'migrations',
    directory: path.join(__dirname, '..', '..', 'db-migrations')
  },
  pool: {
    min: 1,
    max: 2
  }
})

const knexBlob = knex({
  client: 'pg',
  connection: BLOB_DB_CONNECTION_URI,
  migrations: {
    tableName: 'migrations',
    directory: path.join(__dirname, '..', '..', 'blobs-migrations')
  },
  pool: {
    min: 1,
    max: 2
  }
})
const blobs = new KnexBlobStorage(knexBlob, undefined, api)
const ds = new KnexDatasource(knexInstance)

let indexManager
let crawler = null
let execQueue = null
let rabbitConnection = null

// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------

async function main () {
  rabbitConnection = await ampq.connect(RABBITMQ_URI)
  const rabbitChannel = await rabbitConnection.createChannel()
  await rabbitChannel.prefetch(20)
  execQueue = new RabbitQueue(rabbitChannel, 'exectx')
  await execQueue.setUp()
  indexManager = new ExecutionManager(blobs, execQueue)
  await indexManager.setUp()
  crawler = new Crawler(indexManager, api, ds, logger, { initialBlockConcurrency: 20 })
  await ds.setUp()
  await blobs.setUp()
  await crawler.start(INITIAL_CRAWL_HEIGHT ? Number(INITIAL_CRAWL_HEIGHT) : 0)
}

// ------------------------------------------------------------------------------------------------
// shutdown
// ------------------------------------------------------------------------------------------------

async function shutdown () {
  logger.debug('Shutting down')
  if (crawler !== null) {
    await crawler.stop()
  }
  await blobs.tearDown()
  await ds.tearDown()
  if (indexManager !== null) {
    await indexManager.tearDown()
  }
  await indexManager.tearDown()
  if (execQueue !== null) {
    await execQueue.tearDown()
  }
  if (rabbitConnection !== null) {
    await rabbitConnection.close()
  }
  process.exit(0)
}

// ------------------------------------------------------------------------------------------------

process.on('SIGTERM', shutdown)

main()
