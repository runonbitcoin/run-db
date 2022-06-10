const { nanoid } = require('nanoid')
const { TOPICS } = require('./topics')

/**
 * Message structure:
 * { topic: 'string', id: 'string', body: {} }
 */

class Port {
  constructor (jsPort, opts = {}) {
    this.port = jsPort
    this.handlers = new Map()
    this.pending = new Map()
    this.generalOpts = {
      timeout: 10000, // default timeout 10s
      ...opts
    }
  }

  async setUp () {
    this.port.on('message', this._onMessage.bind(this))
  }

  async tearDown () {
    for (const { time } of this.pending.values()) {
      clearTimeout(time)
    }
    // this.port.close()
  }

  async send (topic, body, opts = {}) {
    const id = nanoid()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('timeout'))
      }, opts.timeout || this.generalOpts.timeout)

      this.pending.set(id, { resolve, reject, timer })
      this.port.postMessage({ id, topic, body })
    })
  }

  subscribe (topic, handler) {
    this.handlers.set(topic, handler)
  }

  async _onMessage (msg) {
    if (!msg.topic) { throw new Error('malformed msg. missing topic') }
    if (!msg.id) { throw new Error('malformed msg. missing id') }

    if (msg.topic === TOPICS.response) {
      const { replyTo, error, response } = msg.body

      if (!replyTo) {
        throw new Error('malformed response message. missing replyTo')
      }

      if (!error && !response) {
        throw new Error('malformed response message. message or error should be present')
      }

      if (error && response) {
        throw new Error('malformed response message. response and error at the same time')
      }

      const pending = this.pending.get(replyTo)
      if (!pending) {
        return
      }

      clearTimeout(pending.timeout)
      if (error) {
        pending.reject(error)
      } else {
        pending.resolve((response))
      }
      this.pending.delete(replyTo)
    } else {
      const handler = this.handlers.get(msg.topic)
      if (!handler) { return }
      try {
        const response = await handler(msg.body)
        return this.send('response', { replyTo: msg.id, response, error: null })
      } catch (e) {
        return this.send('response', { replyTo: msg.id, response: null, error: { message: e.message } })
      }
    }
  }
}

module.exports = { Port }
