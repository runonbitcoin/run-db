
import zmq from 'zeromq'

export default class BitcoinZmq {

  sock: zmq.Socket;

  url: string;

  constructor (url) {
    this.sock = zmq.socket('sub')
    this.url = url
  }

  async connect () {
    this.sock.connect(this.url)
    this.sock.subscribe('rawtx')
  }

  async disconnect () {
    await this.sock.close()
  }

  async subscribeRawTx (handler) {
    this.sock.on('message', (_topic, message) => {
      handler(message)
    })
  }
}

