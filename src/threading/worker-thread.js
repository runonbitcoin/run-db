const { Worker } = require('worker_threads')
const { Port } = require('./port')

class WorkerThread {
  constructor (path, workerData) {
    this.path = path
    this.workerData = workerData
    this.port = null
  }

  async setUp () {
    this.worker = new Worker(this.path, {
      workerData: this.workerData
    })
    this.port = new Port(this.worker)
    await this.port.setUp()
  }

  async tearDown () {
    await this.worker.terminate()
  }

  subscribe (topic, handler) {
    this.port.subscribe(topic, handler)
  }
}

module.exports = { WorkerThread }
