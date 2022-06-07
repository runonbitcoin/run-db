/**
 * index.js
 *
 * Entry point
 */

const ampq = require('amqplib')
const Indexer = require('../indexer')
const {
  RABBITMQ_URI,
  BLOB_DB_CONNECTION_URI,
  MAIN_DB_CONNECTION_URI,
  WORKERS,
  NETWORK
} = require('../config')

const {
  KnexDatasource,
  knex,
  KnexBlobStorage,
  TrustAllTrustList,
  Executor,
  RabbitQueue,
  ExecutionWorker
} = require('../index')

const logger = console
const network = NETWORK
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
const trustList = new TrustAllTrustList()
const executor = new Executor(network, WORKERS, blobs, ds, logger, {
  cacheProviderPath: require.resolve('../worker/knex-cache-provider'),
  workerEnv: {
    BLOB_DB_CLIENT: 'pg',
    BLOB_DB_CONNECTION_URI: BLOB_DB_CONNECTION_URI
  }
})
const indexer = new Indexer(null, ds, blobs, trustList, executor, network, logger)
let execQueue = null
let trustQueue = null
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
  trustQueue = new RabbitQueue(rabbitChannel, 'trusttx')
  worker = new ExecutionWorker(indexer, execQueue, trustQueue)

  await execQueue.setUp()
  await trustQueue.setUp()
  await ds.setUp()
  await blobs.setUp()
  await executor.start()
  await indexer.start()
  await worker.setUp()
}

// ------------------------------------------------------------------------------------------------
// shutdown
// ------------------------------------------------------------------------------------------------

async function shutdown () {
  logger.debug('Shutting down')
  await worker.tearDown()
  await executor.stop()
  await blobs.tearDown()
  await ds.tearDown()
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
