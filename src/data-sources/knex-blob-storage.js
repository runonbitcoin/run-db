const crypto = require('crypto')

const identity = (a) => a

const defaultFilter = {
  serialize: identity,
  deserialize: identity
}

class KnexBlobStorage {
  constructor (knex, statateTransformation = defaultFilter) {
    this.knex = knex
    this.filter = statateTransformation
  }

  async pushJigState (location, stateObject) {
    if (!location) {
      throw new Error('missing location')
    }

    if (!stateObject) {
      throw new Error('missing state')
    }

    await this.knex('jig_states')
      .insert({ location, state: this.filter.serialize(stateObject) })
      .onConflict('location').merge()
  }

  async pullJigState (location, ifNone) {
    const result = await this.knex('jig_states')
      .where('location', location)
      .first('state')

    if (!result) {
      return ifNone()
    }
    return this.filter.deserialize(result.state)
  }

  async pullTx (txid, ifNone) {
    const result = await this.knex('raw_transactions')
      .where('txid', txid)
      .first('bytes')
    if (!result) {
      return ifNone()
    }
    return result.bytes
  }

  async pushTx (txid = null, rawTx) {
    if (!rawTx) {
      throw new Error('missing rawtx')
    }

    txid = txid || this._hash(rawTx)
    await this.knex('raw_transactions')
      .insert({ txid, bytes: rawTx })
      .onConflict('txid').merge()
    return txid
  }

  _hash (buffer) {
    const middle = crypto.createHash('sha256').update(buffer).digest()
    const response = crypto.createHash('sha256').update(middle).digest()
    return response.reverse().toString('hex')
  }
}

module.exports = { KnexBlobStorage }
