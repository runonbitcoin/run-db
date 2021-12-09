/**
 * direct-server-worker.js
 *
 * Internal worker thread that runs the user server
 */

const { parentPort, workerData } = require('worker_threads')
const Server = require('./server')
const Bus = require('./bus')
const Database = require('./database')
const { SqliteDatasource } = require('./data-sources/sqlite-datasource')
const { DATA_SOURCE, DB, DATA_API_ROOT } = require('./config')
const { SqliteMixedDatasource } = require('./data-sources/sqlite-mixed-datasource')

const logger = {
  info: (...args) => Bus.sendRequest(parentPort, 'info', ...args),
  warn: (...args) => Bus.sendRequest(parentPort, 'warn', ...args),
  error: (...args) => Bus.sendRequest(parentPort, 'error', ...args),
  debug: (...args) => Bus.sendRequest(parentPort, 'debug', ...args)
}

const readonly = true

let dataSource
if (DATA_SOURCE === 'sqlite') {
  dataSource = new SqliteDatasource(DB, logger, readonly)
} else if (DATA_SOURCE === 'mixed') {
  dataSource = new SqliteMixedDatasource(DB, logger, readonly, DATA_API_ROOT)
} else {
  throw new Error(`unknown datasource: ${DATA_SOURCE}. Please check "DATA_SOURCE" configuration.`)
}

const database = new Database(dataSource, logger)
const server = new Server(database, logger, workerData.port)

database.trust = (txid) => Bus.sendRequest(parentPort, 'trust', txid)
database.ban = (txid) => Bus.sendRequest(parentPort, 'ban', txid)
database.addTransaction = (txid, hex) => Bus.sendRequest(parentPort, 'addTransaction', txid, hex)
database.untrust = (txid) => Bus.sendRequest(parentPort, 'untrust', txid)
database.unban = (txid) => Bus.sendRequest(parentPort, 'unban', txid)
database.deleteTransaction = (txid) => Bus.sendRequest(parentPort, 'deleteTransaction', txid)

Bus.listen(parentPort, { start, stop })

async function start () {
  await database.open()
  await server.start()
}

async function stop () {
  await server.stop()
  await database.close()
}
