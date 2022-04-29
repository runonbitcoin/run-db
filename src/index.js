/**
 * index.js
 *
 * Main module
 */

const BitcoinNodeConnection = require('./blockchain-api/bitcoin-node-connection')
const BitcoinRpc = require('./blockchain-api/bitcoin-rpc')
const BitcoinZmq = require('./blockchain-api/bitcoin-zmq')
const Bus = require('./bus')
const Crawler = require('./crawler')
const Downloader = require('./downloader')
const Indexer = require('./indexer')
const RunConnectFetcher = require('./blockchain-api/run-connect')
const config = require('./config')
const dataSources = require('./data-sources')
const execution = require('./execution')
const http = require('./http')
const trustList = require('./trust-list')
const { CacheProvider } = require('./worker/cache-provider')
const { Clock } = require('./clock')

module.exports = {
  BitcoinNodeConnection,
  BitcoinRpc,
  BitcoinZmq,
  Bus,
  CacheProvider,
  Clock,
  Crawler,
  Downloader,
  Indexer,
  RunConnectFetcher,
  config,
  dataSources,
  execution,
  http,
  trustList
}
