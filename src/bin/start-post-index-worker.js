/**
 * index.js
 *
 * Entry point
 */

const ampq = require('amqplib')
const {
  RABBITMQ_URI,
  MAIN_DB_CONNECTION_URI
} = require('../config')

const {
  KnexDatasource,
  knex,
  RabbitQueue
} = require('../index')
const { ExecutingSet } = require('../executing-set')
const { PostIndexWorker } = require('../post-index-worker')
const { PostIndexer } = require('../post-indexer')

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
    max: 4
  }
})

const ds = new KnexDatasource(knexInstance)
const execSet = new ExecutingSet(ds)
const postIndexer = new PostIndexer(ds, logger)
let execQueue = null
let postIndexQueue = null
let rabbitConnection = null
let worker = null
// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------

async function main () {
  rabbitConnection = await ampq.connect(RABBITMQ_URI)
  const rabbitChannel = await rabbitConnection.createChannel()
  await rabbitChannel.prefetch(1)
  execQueue = new RabbitQueue(rabbitChannel, 'exectx')
  postIndexQueue = new RabbitQueue(rabbitChannel, 'postIndexTx')
  worker = new PostIndexWorker(postIndexer, execSet, execQueue, postIndexQueue, logger)

  await execQueue.setUp()
  await postIndexQueue.setUp()
  await ds.setUp()
  await postIndexer.setUp()
  await worker.setUp()
}

// ------------------------------------------------------------------------------------------------
// shutdown
// ------------------------------------------------------------------------------------------------

async function shutdown () {
  logger.debug('Shutting down')
  await worker.tearDown()
  await ds.tearDown()
  if (execQueue !== null) {
    await execQueue.tearDown()
  }
  if (postIndexQueue !== null) {
    await postIndexQueue.tearDown()
  }
  if (rabbitConnection !== null) {
    await rabbitConnection.close()
  }
  process.exit(0)
}

// ------------------------------------------------------------------------------------------------

process.on('SIGTERM', shutdown)

main()
