/**
 * index.js
 *
 * Entry point
 */

const axios = require('axios')
const Indexer = require('./indexer')
const Server = require('./server')
const { API, DB, NETWORK, PORT, FETCH_LIMIT, WORKERS, MATTERCLOUD_KEY, PLANARIA_TOKEN, START_HEIGHT } = require('./config')
const MatterCloud = require('./mattercloud')
const Planaria = require('./planaria')

// ------------------------------------------------------------------------------------------------
// RunConnectFetcher
// ------------------------------------------------------------------------------------------------

class RunConnectFetcher {
  async connect (height, network) {
    this.network = network
  }

  async fetch (txid) {
    const response = await axios.get(`https://api.run.network/v1/${this.network}/tx/${txid}`)
    return response.data.hex
  }
}

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = console

let api = null
switch (API) {
  case 'mattercloud': api = new MatterCloud(MATTERCLOUD_KEY, logger); break
  case 'planaria': api = new Planaria(PLANARIA_TOKEN, logger); break
  case 'none': api = new RunConnectFetcher(); break
  default: throw new Error(`Unknown API: ${API}`)
}

const indexer = new Indexer(DB, api, NETWORK, FETCH_LIMIT, WORKERS, logger, START_HEIGHT)

const server = new Server(indexer, logger, PORT)

// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------

async function main () {
  await indexer.start()
  server.start()
}

// ------------------------------------------------------------------------------------------------
// shutdown
// ------------------------------------------------------------------------------------------------

async function shutdown () {
  await indexer.stop()
  process.exit(0)
}

// ------------------------------------------------------------------------------------------------

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main()
