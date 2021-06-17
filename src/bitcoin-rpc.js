const axios = require('axios')
const bsv = require('bsv')

class BitcoinRpc {
  /**
   * Creates an instance to connect with a given rpc url.
   *
   * @param {string} url full connection url, with credentials, port, etc.
   */
  constructor (baseUrl) {
    this.axios = axios.create({
      baseUrl,
      validateStatus: (status) => {
        return status >= 200 && status < 300
      }
    })
  }

  /**
   * @param {String} txid
   */
  async getRawTransaction (txid) {
    return this._rpcCall('getrawtransaction', [txid])
  }

  async getBlockCount () {
    return this._rpcCall('getblockcount', [])
  }

  /**
   * @param {Number} targetHeight block height. must be positive int.
   * @returns object with needed data. txs are bsv transactions
   */
  async getBlockByHeight (targetHeight) {
    const rawblock = await this._rpcCall('getblockbyheight', [targetHeight, false])

    const bsvBlock = bsv.Block.fromRawBlock(Buffer.from(rawblock, 'hex'))

    return {
      height: targetHeight,
      hash: bsvBlock.header.prevHash,
      time: bsvBlock.header.time,
      txs: bsvBlock.transactions
    }
  }

  async _rpcCall (method, params) {
    const response = await this.axios.post('/', JSON.stringify({
      jsonrpc: '1.0',
      id: new Date().getTime(),
      method: method,
      params: params
    }))

    const { error, result } = response.data

    if (error !== null) {
      throw new Error(error)
    }

    return result
  }
}

module.exports = BitcoinRpc
