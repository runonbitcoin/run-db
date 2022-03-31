const fetch = require('node-fetch')

const httpPost = async (url, jsonBody) => {
  const response = await fetch(url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(jsonBody)
    }
  )

  if (!response.ok) {
    throw new Error(`error during rpc call: ${jsonBody.method}, ${jsonBody.params}`)
  }

  return response
}

class BitcoinRpc {
  /**
   * Creates an instance to connect with a given rpc url.
   *
   * @param {string} baseUrl full connection url, with credentials, port, etc.
   */
  constructor (baseUrl) {
    this.baseUrl = baseUrl
  }

  /**
   * @param {String} txid
   * @param {boolean} verbose
   */
  async getRawTransaction (txid, verbose = true) {
    return this._rpcCall('getrawtransaction', [txid, verbose])
  }

  async getBlockCount () {
    return this._rpcCall('getblockcount', [])
  }

  async getBlockHash (height) {
    return this._rpcCall('getblockhash', [height])
  }

  /**
   * @param {Number} targetHeight block height. must be positive int.
   * @returns object with needed data. txs are bsv transactions
   */
  async getBlockDataByHeight (targetHeight) {
    return this._rpcCall('getblockbyheight', [targetHeight, true])
  }

  /**
   * @param {String} targetHash block hash.
   * @returns object with needed data. txs are bsv transactions
   */
  async getBlockDataByHash (targetHash) {
    return this._rpcCall('getblock', [targetHash, true])
  }

  /**
   * @param {String} targetHash block hash.
   * @returns object with needed data. txs are bsv transactions
   */
  async getBlockHexByHash (targetHash) {
    return this._rpcCall('getblock', [targetHash, false])
  }

  async _rpcCall (method, params) {
    const response = await this._httpPost(this.baseUrl, {
      jsonrpc: '1.0',
      method: method,
      params: params
    })

    const { error, result } = await response.json()

    if (error !== null) {
      throw new Error(error)
    }

    return result
  }

  async _httpPost (url, jsonBody) {
    try {
      return httpPost(url, jsonBody)
    } catch (e) {
      // In case of an error requesting to the node we do 1 retry after 2 seconds.
      console.error(e.message)
      console.log('retrying...')
      await new Promise(resolve => setTimeout(resolve, 2000))
      return httpPost(url, jsonBody)
    }
  }
}

module.exports = BitcoinRpc
