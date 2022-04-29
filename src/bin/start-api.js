/**
 * index.js
 *
 * Entry point
 */

const ampq = require('amqplib')
const {
  RABBITMQ_URI,
  PORT,
  MAIN_DB_CONNECTION_URI,
  BLOB_DB_CONNECTION_URI
} = require('../config')

const { KnexDatasource } = require('../data-sources/knex-datasource')
const knex = require('knex')
const { KnexBlobStorage } = require('../data-sources/knex-blob-storage')
const { ExecutionManager } = require('../execution-manager')
const { RabbitQueue } = require('../queues/rabbit-queue')
const { buildMainServer } = require('../http')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = console
const knexInstance = knex({
  client: 'pg',
  connection: MAIN_DB_CONNECTION_URI,
  migrations: {
    tableName: 'migrations',
    directory: 'db-migrations'
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
    directory: 'blobs-migrations'
  },
  pool: {
    min: 1,
    max: 2
  }
})
const blobs = new KnexBlobStorage(knexBlob)
const ds = new KnexDatasource(knexInstance)
let indexManager = null
let execQueue = null
let trustQueue = null
let rabbitChannel = null
let rabbitConnection = null
let server = null

// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------

async function main () {
  rabbitConnection = await ampq.connect(RABBITMQ_URI)
  rabbitChannel = await rabbitConnection.createChannel()
  await rabbitChannel.prefetch(20)
  execQueue = new RabbitQueue(rabbitChannel, 'exectx')
  trustQueue = new RabbitQueue(rabbitChannel, 'trusttx')
  indexManager = new ExecutionManager(blobs, execQueue, trustQueue)
  server = buildMainServer(ds, blobs, indexManager, logger)
  await execQueue.setUp()
  await trustQueue.setUp()
  await ds.setUp()
  await blobs.setUp()
  await indexManager.setUp()
  await server.start(PORT)
}

// ------------------------------------------------------------------------------------------------
// shutdown
// ------------------------------------------------------------------------------------------------

async function shutdown () {
  logger.debug('Shutting down')
  await blobs.tearDown()
  await ds.tearDown()
  if (indexManager !== null) {
    indexManager.tearDown()
  }
  if (execQueue !== null) {
    await execQueue.tearDown()
  }
  if (rabbitChannel !== null) {
    await rabbitChannel.close()
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
