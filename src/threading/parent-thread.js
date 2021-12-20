const { parentPort } = require('worker_threads')

class ParentThread {
  constructor () {
    this.parent = parentPort
    this.parent.on('message', this._onMessage.bind(this))
    this.handlers = new Map()
  }

  async _onMessage (msg) {
    const { headers, body } = msg
    const handler = this.handlers.get(headers.topic)
    if (!handler) {
      throw new Error(`unknown topic: ${headers.topic}`)
    }
    try {
      const response = await handler(body)
      this.parent.postMessage({
        headers: {
          replyTo: headers.id,
          type: 'response'
        },
        body: response
      })
    } catch (e) {
      this.parent.postMessage({
        headers: {
          replyTo: headers.id,
          type: 'error'
        },
        body: e
      })
    }
  }
}

module.exports = { ParentThread }
