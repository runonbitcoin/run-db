const { Worker } = require('worker_threads')
const { Port } = require('./port')

class WorkerThread {
  constructor (path, workerData, opts = {}) {
    this.path = path
    this.workerData = workerData
    this.portOpts = opts
    this.port = null
  }

  async setUp () {
    this.worker = new Worker(this.path, {
      workerData: this.workerData,
      env: this.portOpts.env || {}
    })
    this.port = new Port(this.worker, this.portOpts)
    await this.port.setUp()
  }

  async tearDown () {
    await this.port.tearDown()
    await this.worker.terminate()
  }

  subscribe (topic, handler) {
    this.port.subscribe(topic, handler)
  }

  async send (topic, body, opts) {
    return this.port.send(topic, body, opts)
  }
}

module.exports = { WorkerThread }
