const returnNull = () => null

class MemoryBlobStorage {
  constructor () {
    this._states = new Map()
    this._txs = new Map()
  }

  async pushJigState (location, stateObject) {
    this._states.set(location, stateObject)
  }

  async pullJigState (location, ifNone = returnNull) {
    const state = this._states.get(location)
    if (!state) {
      return ifNone(location)
    }
    return state
  }

  async pushTx (txid, txBuff) {
    this._txs.set(txid, txBuff)
  }

  async pullTx (txid, ifNone = returnNull) {
    const txBuff = this._txs.get(txid)
    if (!txBuff) {
      return ifNone(txid)
    }
    return txBuff
  }
}

module.exports = { MemoryBlobStorage }
