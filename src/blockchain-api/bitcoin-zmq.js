let zmq
try {
  zmq = require('zeromq')
} catch (e) {}

class BitcoinZmq {
  constructor (url) {
    this.sock = new zmq.Subscriber()
    this.url = url
    this.handlers = new Map()
  }

  async connect () {
    await this.sock.connect(this.url)
    for await (const [topic, msg] of this.sock) {
      const txid = msg.toString('hex')
      const handler = this.handlers.get(topic.toString())
      if (handler) {
        handler(txid)
      }
    }
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
