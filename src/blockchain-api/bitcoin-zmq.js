let zmq
try {
  zmq = require('zeromq')
} catch (e) {}

// this.sock.subscribe('rawtx')
// this.sock.subscribe('hashblock')

class BitcoinZmq {
  constructor (url) {
    this.sock = zmq.socket('sub')
    this.url = url
    this.handlers = new Map()
  }

  async connect () {
    this.sock.connect(this.url)
    this.sock.on('message', (topic, message) => {
      const handler = this.handlers.get(topic)
      if (handler) {
        handler(message)
      }
    })
  }

  async subscribe (topic, handler) {
    this.handlers.set(topic, handler)
  }

  async disconnect () {
    await this.sock.close()
  }

  // async subscribeRawTx (handler) {
  //   this.sock.on('message', (_topic, message) => {
  //     handler(message)
  //   })
  // }
}

module.exports = BitcoinZmq
