/**
 * index.js
 *
 * Entry point
 */

const Indexer = require('../indexer')
const {
  API,
  DB,
  NETWORK,
  PORT,
  FETCH_LIMIT,
  WORKERS,
  MATTERCLOUD_KEY,
  PLANARIA_TOKEN,
  START_HEIGHT,
  MEMPOOL_EXPIRATION,
  ZMQ_URL,
  RPC_URL,
  DEFAULT_TRUSTLIST,
  DEBUG,
  SERVE_ONLY,
  DATA_SOURCE,
  WORKER_CACHE_TYPE,
  TRUST_LIST,
  EXECUTOR,
  EXECUTE_ENDPOINT,
  DATA_API_TX_ROOT,
  DATA_API_STATE_ROOT,
  PRESERVE_STDOUT,
  PRESERVE_STDERR
} = require('../config')
const MatterCloud = require('../mattercloud')
const Planaria = require('../planaria')
const RunConnectFetcher = require('../run-connect')
const BitcoinNodeConnection = require('../bitcoin-node-connection')
const BitcoinRpc = require('../bitcoin-rpc')
const BitcoinZmq = require('../bitcoin-zmq')
const Database = require('../database')
const { SqliteDatasource } = require('../data-sources/sqlite-datasource')
const { SqliteMixedDatasource } = require('../data-sources/sqlite-mixed-datasource')
const { ApiBlobStorage } = require('../data-sources/api-blob-storage')
const { DbTrustList } = require('../trust-list/db-trust-list')
const { TrustAllTrustList } = require('../trust-list/trust-all-trust-list')
const { buildMainServer } = require('../http/build-main-server')
const Executor = require('../execution/executor')
const { ApiExecutor } = require('../execution/api-executor')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = {}
logger.info = console.info.bind(console)
logger.warn = console.warn.bind(console)
logger.error = console.error.bind(console)
logger.debug = DEBUG ? console.debug.bind(console) : () => {}

let api = null
switch (API) {
  case 'mattercloud':
    api = new MatterCloud(MATTERCLOUD_KEY, logger)
    break
  case 'planaria':
    api = new Planaria(PLANARIA_TOKEN, logger)
    break
  case 'bitcoin-node':
    if (ZMQ_URL === null) {
      throw new Error('please specify ZQM_URL when using bitcoin-node API')
    }

    if (RPC_URL === null) {
      throw new Error('please specify RPC_URL when using bitcoin-node API')
    }
    api = new BitcoinNodeConnection(new BitcoinZmq(ZMQ_URL), new BitcoinRpc(RPC_URL))
    break
  case 'run':
    api = new RunConnectFetcher()
    break
  case 'none':
    api = {}
    break
  default:
    throw new Error(`Unknown API: ${API}`)
}

const readonly = !!SERVE_ONLY

let dataSource
if (DATA_SOURCE === 'sqlite') {
  dataSource = new SqliteDatasource(DB, logger, readonly)
} else if (DATA_SOURCE === 'mixed') {
  const blobStorage = new ApiBlobStorage(DATA_API_TX_ROOT, DATA_API_STATE_ROOT)
  dataSource = new SqliteMixedDatasource(DB, logger, readonly, blobStorage)
} else {
  throw new Error(`unknown datasource: ${DATA_SOURCE}. Please check "DATA_SOURCE" configuration.`)
}

let trustList
if (TRUST_LIST === 'db') {
  trustList = new DbTrustList(dataSource)
} else if (TRUST_LIST === 'all') {
  trustList = new TrustAllTrustList(dataSource)
}

const database = new Database(dataSource, trustList, logger)

const executor = EXECUTOR === 'local'
  ? new Executor(NETWORK, WORKERS, database, logger, {
      cacheType: WORKER_CACHE_TYPE,
      txApiRoot: DATA_API_TX_ROOT,
      stateApiRoot: DATA_API_STATE_ROOT,
      preserveStdout: PRESERVE_STDOUT,
      preserveStdErr: PRESERVE_STDERR
    })
  : new ApiExecutor(EXECUTE_ENDPOINT, trustList, NETWORK, WORKERS, logger)

const indexer = new Indexer(
  database,
  api,
  executor,
  NETWORK,
  FETCH_LIMIT,
  logger,
  START_HEIGHT,
  MEMPOOL_EXPIRATION,
  DEFAULT_TRUSTLIST
)

const server = buildMainServer(database, logger, readonly)

let started = false

// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------

async function main () {
  await database.open()

  if (!SERVE_ONLY) {
    await indexer.start()
  }

  await server.start(PORT)

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
