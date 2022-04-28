let zmq
try {
  zmq = require('zeromq')
} catch (e) {}

class BitcoinZmq {
  constructor (url) {
    this.sock = zmq.socket('sub')
    this.url = url
    this.handlers = new Map()
  }

  async connect () {
    this.sock.connect(this.url)
    this.sock.on('message', (topic, message) => {
      const handler = this.handlers.get(topic.toString())
      if (handler) {
        handler(message)
      }
    })
  }

  async subscribe (topic, handler) {
    this.sock.subscribe(topic)
    this.handlers.set(topic, handler)
  }

  async disconnect () {
    if (!this.sock.closed) {
      await this.sock.close()
    }
  }
}

module.exports = BitcoinZmq
