const { PORT, DEBUG, WORKERS, DATA_API_ROOT, NETWORK } = require('../config')
const { buildExecutionServer } = require('../http/build-execution-server')
const { ApiBlobStorage } = require('../data-sources/api-blob-storage')

const logger = {}
logger.info = console.info.bind(console)
logger.warn = console.warn.bind(console)
logger.error = console.error.bind(console)
logger.debug = DEBUG ? console.debug.bind(console) : () => {}

const blobStorage = new ApiBlobStorage(DATA_API_ROOT)

const server = buildExecutionServer(
  logger,
  WORKERS,
  blobStorage,
  require.resolve('../worker.js'),
  NETWORK,
  {
    dataApiRoot: DATA_API_ROOT
  }
)

async function main () {
  await server.start(PORT)
}

const shutdown = async () => {
  await server.stop()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main()
