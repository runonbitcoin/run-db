const axios = require('axios')

class BitcoinRpc {
  /**
   * Creates an instance to connect with a given rpc url.
   *
   * @param {string} url full connection url, with credentials, port, etc.
   */
  constructor (baseUrl) {
    this.baseUrl = baseUrl
    this.axios = axios.create({
      validateStatus: (status) => {
        return status >= 200 && status < 300
      }
    })
  }

  /**
   * @param {String} txid
   */
  async getRawTransaction (txid, verbose = true) {
    return this._rpcCall('getrawtransaction', [txid, verbose])
  }

  async getBlockCount () {
    return this._rpcCall('getblockcount', [])
  }

  /**
   * @param {Number} targetHeight block height. must be positive int.
   * @returns object with needed data. txs are bsv transactions
   */
  async getBlockByHeight (targetHeight, verbose = false) {
    return this._rpcCall('getblockbyheight', [targetHeight, verbose])
  }

  async _rpcCall (method, params) {
    const response = await this._httpPost(this.baseUrl, {
      jsonrpc: '1.0',
      id: new Date().getTime(),
      method: method,
      params: params
    })

    const { error, result } = response.data

    if (error !== null) {
      throw new Error(error)
    }

    return result
  }

  /**
   * We do 1 retry here because the node has flukes from time to time.
   * @param {string} url
   * @param {object} body
   * @returns axios response
   */
  async _httpPost (url, body) {
    const serializedBody = JSON.stringify(body)
    try {
      return this.axios.post(url, serializedBody)
    } catch (e) {
      if (e.response) {
        throw (e)
      } else {
        console.log(`retrying rpc request: ${serializedBody}`)
        return this.axios.post(url, serializedBody)
      }
    }
  }
}

module.exports = BitcoinRpc
