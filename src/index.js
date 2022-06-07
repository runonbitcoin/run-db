/**
 * index.js
 *
 * Main module
 */

const BitcoinNodeConnection = require('./blockchain-api/bitcoin-node-connection')
const BitcoinRpc = require('./blockchain-api/bitcoin-rpc')
const BitcoinZmq = require('./blockchain-api/bitcoin-zmq')
const Bus = require('./bus')
const Indexer = require('./indexer')
const RunConnectFetcher = require('./blockchain-api/run-connect')
const config = require('./config')
const dataSources = require('./data-sources')
const execution = require('./execution')
const http = require('./http')
const knex = require('knex')
const trustList = require('./trust-list')
const { CacheProvider } = require('./worker/cache-provider')
const { Clock } = require('./clock')
const { Crawler } = require('./crawler')
const { ExecutionManager } = require('./execution-manager')
const { ExecutionWorker } = require('./execution-worker')
const { KnexBlobStorage } = require('./data-sources/knex-blob-storage')
const { KnexDatasource } = require('./data-sources')
const { RabbitQueue } = require('./queues/rabbit-queue')
const { RunConnectBlockchainApi } = require('./blockchain-api/run-connect')
const { TrustAllTrustList } = require('./trust-list')
const { buildMainServer } = require('./http')

module.exports = {
  BitcoinNodeConnection,
  BitcoinRpc,
  BitcoinZmq,
  Bus,
  CacheProvider,
  Clock,
  Crawler,
  ExecutionManager,
  ExecutionWorker,
  Indexer,
  KnexBlobStorage,
  KnexDatasource,
  RabbitQueue,
  RunConnectBlockchainApi,
  RunConnectFetcher,
  TrustAllTrustList,
  buildMainServer,
  config,
  dataSources,
  execution,
  http,
  knex,
  trustList
}
