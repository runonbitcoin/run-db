/**
 * database.js
 *
 * Layer between the database and the application
 */
const { SqliteDatasource } = require('./sqlite-datasource')
const fetch = require('node-fetch')

// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------

class SqliteMixedDatasource extends SqliteDatasource {
  constructor (path, logger, readonly, baseApiUrl) {
    super(path, logger, readonly)
    this.baseApiUrl = baseApiUrl
  }

  async extraSchemaMigrations () {
    this.connection.exec(`
      ALTER TABLE tx DROP COLUMN bytes;
    `)
    this.connection.exec(`
      ALTER TABLE jig DROP COLUMN state;
    `)
    this.connection.exec(`
      ALTER TABLE berry DROP COLUMN state;
    `)
  }

  async setUp () {
    await super.setUp()
    await this.extraSchemaMigrations()
    this.getJigStateStmt = null
    this.setJigStateStmt = null
    this.getBerryStateStmt = null
    this.setBerryStateStmt = null
  }

  async getTxHex (txid) {
    const row = this.getTransactionHexStmt.raw(true).get(txid)
    return row && row[0]
  }

  async setTxBytes (txid, bytes) {
    this.setTransactionBytesStmt.run(bytes, txid)
  }

  // jig

  async getJigState (location) {
    return this._pullJigState(location)
  }

  async setJigState (location, stateObject) {
    await this._pushJigState(location, stateObject)
  }

  async getBerryState (location) {
    return this._pullJigState(location)
  }

  async setBerryState (location, stateObject) {
    return this._pushJigState(location, stateObject)
  }

  async _pullJigState (location) {
    const result = await fetch(`${this.baseApiUrl}/state/${location}`)
    if (result.status === 404) {
      return null
    }

    if (!result.ok) {
      throw new Error(`error fetching jig state ${location}`)
    }

    return result.json()
  }

  async _pushJigState (location, stateObject) {
    const result = await fetch(`${this.baseApiUrl}/state`, {
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
}

// ------------------------------------------------------------------------------------------------

module.exports = { SqliteMixedDatasource }
