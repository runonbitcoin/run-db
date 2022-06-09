const { nanoid } = require('nanoid')
const { TOPICS } = require('./topics')

/**
 * Message structure:
 * { topic: 'string', id: 'string', body: {} }
 */

class Port {
  constructor (jsPort) {
    this.port = jsPort
    this.handlers = new Map()
    this.pending = new Map()
  }

  async setUp () {
    this.port.on('message', this._onMessage.bind(this))
  }

  async tearDown () {
    this.port.close()
  }

  async send (topic, body) {
    const id = nanoid()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
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

      const handler = this.pending.get(replyTo)
      if (!handler) {
        return
      }

      if (error) {
        handler.reject(error)
      } else {
        handler.resolve((response))
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
