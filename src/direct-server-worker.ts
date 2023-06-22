/**
 * direct-server-worker.js
 *
 * Internal worker thread that runs the user server
 */

const { parentPort, workerData } = require('worker_threads')
const Server = require('./server')
const Bus = require('./bus')
const Database = require('./database')

const logger = {
  info: (...args) => Bus.sendRequest(parentPort, 'info', ...args),
  warn: (...args) => Bus.sendRequest(parentPort, 'warn', ...args),
  error: (...args) => Bus.sendRequest(parentPort, 'error', ...args),
  debug: (...args) => Bus.sendRequest(parentPort, 'debug', ...args)
}

const readonly = true
const database = new Database(workerData.dbPath, logger, readonly)
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
