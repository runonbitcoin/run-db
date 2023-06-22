/**
 * direct-server.js
 *
 * Serves GET requets directly from the database and proxies other requests to the normal server
 */

import { Worker } from 'worker_threads'

const Bus = require('./bus')

import { Logger } from './logger'

import Database from './database'

import { join } from 'path'

export default class DirectServer {

  dbPath: string;

  port: number;

  logger: Logger;

  database: Database;

  worker: Worker;

  constructor (dbPath: string, port: number, logger: Logger, database: Database) {
    this.dbPath = dbPath
    this.port = port
    this.logger = logger
    this.database = database
    this.worker = null
  }

  async start () {
    if (this.worker) return
    const path = join(__dirname, './direct-server-worker.ts')
    const workerData = { dbPath: this.dbPath, port: this.port }
    this.worker = new Worker(path, { workerData })

    const handlers = {
      info: this.logger.info.bind(this.logger),
      warn: this.logger.warn.bind(this.logger),
      error: this.logger.error.bind(this.logger),
      debug: this.logger.debug.bind(this.logger),
      trust: this.database.trust.bind(this.database),
      ban: this.database.ban.bind(this.database),
      addTransaction: this.database.addTransaction.bind(this.database),
      untrust: this.database.untrust.bind(this.database),
      unban: this.database.unban.bind(this.database),
      deleteTransaction: this.database.deleteTransaction.bind(this.database)
    }

    Bus.listen(this.worker, handlers)

    await Bus.sendRequest(this.worker, 'start')
  }

  async stop () {
    if (!this.worker) return
    await Bus.sendRequest(this.worker, 'stop')
    await this.worker.terminate()
    this.worker = null
  }
}

