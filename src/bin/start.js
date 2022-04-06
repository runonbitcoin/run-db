/**
 * index.js
 *
 * Entry point
 */

const ampq = require('amqplib')
const Indexer = require('../indexer')
const {
  NETWORK,
  WORKERS,
  ZMQ_URL,
  RPC_URL,
  RABBITMQ_URI
} = require('../config')

const { KnexDatasource } = require('../data-sources/knex-datasource')
const knex = require('knex')
const { Crawler, BitcoinNodeConnection, BitcoinZmq, BitcoinRpc } = require('../index')
const { KnexBlobStorage } = require('../data-sources/knex-blob-storage')
const { TrustAllTrustList } = require('../trust-list')
const { Executor } = require('../execution')
const { ExecutionManager } = require('../execution-manager')
const { RabbitQueue } = require('../queues/rabbit-queue')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

// const executor = EXECUTOR === 'local'
//   ? new Executor(NETWORK, WORKERS, database, logger, {
//       cacheType: WORKER_CACHE_TYPE,
//       txApiRoot: DATA_API_TX_ROOT,
//       stateApiRoot: DATA_API_STATE_ROOT,
//       preserveStdout: PRESERVE_STDOUT,
//       preserveStdErr: PRESERVE_STDERR
//     })
//   : new ApiExecutor(EXECUTE_ENDPOINT, trustList, NETWORK, WORKERS, logger)
const logger = console
const zmq = new BitcoinZmq(ZMQ_URL)
const rpc = new BitcoinRpc(RPC_URL)
const api = new BitcoinNodeConnection(zmq, rpc)
const network = NETWORK
const knexInstance = knex({
  client: 'pg',
  connection: process.env.MAIN_DB_CONNECTION_URI,
  migrations: {
    tableName: 'migrations',
    directory: 'db-migrations'
  }
})
const knexBlob = knex({
  client: 'pg',
  connection: process.env.BLOB_DB_CONNECTION_URI,
  migrations: {
    tableName: 'migrations',
    directory: 'blobs-migrations'
  }
})
const blobs = new KnexBlobStorage(knexBlob)
const ds = new KnexDatasource(knexInstance)
const trustList = new TrustAllTrustList()
const executor = new Executor(network, WORKERS, blobs, ds, logger, {
  cacheProviderPath: require.resolve('../worker/knex-cache-provider'),
  workerEnv: {
    BLOB_DB_CLIENT: 'pg',
    BLOB_DB_CONNECTION_URI: process.env.BLOB_DB_CONNECTION_URI
  }
})
const indexer = new Indexer(null, ds, blobs, trustList, executor, network, logger)

// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------

async function main () {
  const rabbitConnection = await ampq.connect(RABBITMQ_URI)
  const rabbitChannel = await rabbitConnection.createChannel()
  const execQueue = new RabbitQueue(rabbitChannel, 'exectx')
  await execQueue.setUp()
  const indexManager = new ExecutionManager(indexer, execQueue)
  const crawler = new Crawler(indexManager, api, ds, logger)
  await ds.setUp()
  await blobs.setUp()
  await indexManager.setUp()
  await executor.start()
  await indexer.start()
  await crawler.start()
}

// ------------------------------------------------------------------------------------------------
// shutdown
// ------------------------------------------------------------------------------------------------

async function shutdown () {
  logger.debug('Shutting down')
  process.exit(0)
}

// ------------------------------------------------------------------------------------------------

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main()
