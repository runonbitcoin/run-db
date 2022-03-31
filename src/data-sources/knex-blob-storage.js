const crypto = require('crypto')
const { JIG_STATES, RAW_TRANSACTIONS } = require('./columns')

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

  async setUp () {
    await this.knex.migrate.latest()
  }

  async tearDown () {
    if (this.knex) {
      await this.knex.destroy()
      this.knex = null
    }
  }

  async pushJigState (location, stateObject) {
    if (!location) {
      throw new Error('missing location')
    }

    if (!stateObject) {
      throw new Error('missing state')
    }

    await this.knex(JIG_STATES.NAME)
      .insert({ location, state: this.filter.serialize(stateObject) })
      .onConflict(JIG_STATES.location).merge()
  }

  async pullJigState (location, ifNone) {
    const result = await this.knex(JIG_STATES.NAME)
      .where(JIG_STATES.location, location)
      .first(JIG_STATES.state)

    if (!result) {
      return ifNone()
    }
    return this.filter.deserialize(result.state)
  }

  async pullTx (txid, ifNone) {
    const result = await this.knex(RAW_TRANSACTIONS.NAME)
      .where(RAW_TRANSACTIONS.txid, txid)
      .first(RAW_TRANSACTIONS.bytes)
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
    await this.knex(RAW_TRANSACTIONS.NAME)
      .insert({ txid, bytes: rawTx })
      .onConflict(RAW_TRANSACTIONS.txid).merge()
    return txid
  }

  _hash (buffer) {
    const middle = crypto.createHash('sha256').update(buffer).digest()
    const response = crypto.createHash('sha256').update(middle).digest()
    return response.reverse().toString('hex')
  }
}

module.exports = { KnexBlobStorage }
