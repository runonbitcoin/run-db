const { Worker } = require('worker_threads')
const { Clock } = require('../clock')
const { nanoid } = require('nanoid')

class TimeoutError extends Error {}

class SubThread {
  constructor (path, workerOpts = {}, clientOpts = {}) {
    this.thread = new Worker(path, workerOpts)
    this.thread.on('message', this._onMessage.bind(this))
    this.thread.on('exit', this._onExit.bind(this))
    this.thread.on('error', this._onError.bind(this))

    this.pending = new Map()
    this.clock = new Clock()
    this.timeoutMs = clientOpts.timeoutMs || 10 * 1000
  }

  send (topic, body, opts) {
    const id = nanoid()
    const headers = { ...opts, id, topic }
    const timeoutMs = opts.timeoutMs || this.timeoutMs

    this.thread.postMessage({ headers, body })
    return new Promise((resolve, reject) => {
      const cancel = this.clock.delay(() => {
        reject(new TimeoutError())
        this.pending.delete(id)
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout: cancel })
    }).finally(
      (data) => {
        const { timeout } = this.pending.get(id)
        timeout.cancel()
        this.pending.delete(id)
        return data
      })
  }

  async _onMessage (msg) {
    const { header: { replyTo, type }, body } = msg
    const { resolve, reject } = this.pending.get(replyTo)
    if (type === 'response') {
      resolve(body)
    } else if (type === 'error') {
      reject(body)
    } else {
      throw new Error(`unknown type: ${type}`)
    }
  }

  async _onExit () {

  }

  async _onError () {

  }
}

module.exports = { SubThread }
