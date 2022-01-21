const fetch = require('node-fetch')

class ApiBlobStorage {
  constructor (baseTxUrl, baseStateUrl) {
    this.txUrl = baseTxUrl
    this.stateUrl = baseStateUrl
  }

  async pushJigState (location, stateObject) {
    const result = await fetch(this.stateUrl, {
      method: 'POST',
      body: JSON.stringify({
        location,
        state: stateObject
      }),
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (!result.ok) {
      throw new Error(`Error saving jig state: ${location}`)
    }
  }

  async pullJigState (location) {
    const result = await fetch(`${this.stateUrl}/${encodeURIComponent(location)}`)
    if (result.status === 404) {
      return null
    }

    if (!result.ok) {
      throw new Error(`error fetching jig state ${location}`)
    }

    const json = await result.json()
    return json.state
  }

  async pullTx (txid, _ifNone) {
    const result = await fetch(`${this.txUrl}/${txid}`)
    return result.buffer()
  }

  async pushTx (_rawTx) {
    // do nothing
  }
}

module.exports = { ApiBlobStorage }
