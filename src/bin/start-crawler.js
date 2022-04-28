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
  INITIAL_CRAWL_HEIGHT
} = require('../config')

const { KnexDatasource } = require('../data-sources/knex-datasource')
const knex = require('knex')
const { Crawler, BitcoinNodeConnection, BitcoinZmq, BitcoinRpc } = require('../index')
const { KnexBlobStorage } = require('../data-sources/knex-blob-storage')
const { ExecutionManager } = require('../execution-manager')
const { RabbitQueue } = require('../queues/rabbit-queue')
const path = require('path')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = console
const zmq = new BitcoinZmq(ZMQ_URL)
const rpc = new BitcoinRpc(RPC_URL)
const api = new BitcoinNodeConnection(zmq, rpc, BITCOIND_REST_URL)
console.log('MAIN_DB_CONNECTION_URI', MAIN_DB_CONNECTION_URI, path.join(__dirname, '..', '..', 'db-migrations'))
const knexInstance = knex({
  client: 'pg',
  connection: MAIN_DB_CONNECTION_URI,
  migrations: {
    tableName: 'migrations',
    directory: path.join(__dirname, '..', '..', 'db-migrations')
  },
  pool: {
    min: 1,
    max: 10
  }
})
console.log('BLOB_DB_CONNECTION_URI', BLOB_DB_CONNECTION_URI, path.join(__dirname, '..', '..', 'blobs-migrations'))
const knexBlob = knex({
  client: 'pg',
  connection: BLOB_DB_CONNECTION_URI,
  migrations: {
    tableName: 'migrations',
    directory: path.join(__dirname, '..', '..', 'blobs-migrations')
  },
  pool: {
    min: 1,
    max: 10
  }
})
const blobs = new KnexBlobStorage(knexBlob)
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
  console.log('RABBITMQ_URI', RABBITMQ_URI)
  const rabbitChannel = await rabbitConnection.createChannel()
  await rabbitChannel.prefetch(20)
  execQueue = new RabbitQueue(rabbitChannel, 'exectx')
  await execQueue.setUp()
  indexManager = new ExecutionManager(blobs, execQueue)
  await indexManager.setUp()
  crawler = new Crawler(indexManager, api, ds, logger)
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
    indexManager.tearDown()
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
process.on('SIGINT', shutdown)

main()
