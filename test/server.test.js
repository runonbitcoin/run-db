/**
 * server.test.js
 *
 * Tests for src/server.test.js
 */

const { describe, it, beforeEach, afterEach } = require('mocha')
require('chai').use(require('chai-as-promised'))
const { expect } = require('chai')
const axios = require('axios')
const Indexer = require('../src/indexer')
const txns = require('./txns.json')
const { DEFAULT_TRUSTLIST } = require('../src/config')
const Database = require('../src/database')
const { SqliteDatasource } = require('../src/data-sources/sqlite-datasource')
const { DbTrustList } = require('../src/trust-list/db-trust-list')
const { buildMainServer } = require('../src/http/build-main-server')
const Executor = require('../src/execution/executor')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const fetch = async txid => {
  return { hex: require('./txns.json')[txid] }
}
const api = { fetch }
const downloaded = (indexer, txid) => new Promise((resolve) => { indexer.onDownload = x => txid === x && resolve() })
const indexed = (indexer, txid) => new Promise((resolve) => { indexer.onIndex = x => txid === x && resolve() })
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
const ds = new SqliteDatasource(':memory:', logger, false)
const trustList = new DbTrustList(ds)
const database = new Database(ds, trustList, logger)

beforeEach(() => database.open())
afterEach(() => database.close())

// ------------------------------------------------------------------------------------------------
// Server
// ------------------------------------------------------------------------------------------------

describe('Server', () => {
  // --------------------------------------------------------------------------
  // post tx
  // --------------------------------------------------------------------------

  describe('post tx', () => {
    it('add with body', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, {}, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      const port = 52521
      await server.start(port)
      const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
      const options = { headers: { 'Content-Type': 'text/plain' } }
      const promise = indexed(indexer, txid)
      await axios.post(`http://localhost:${port}/tx/${txid}`, txns[txid], options)
      await axios.post(`http://localhost:${port}/trust/${txid}`)
      await promise
      await server.stop()
      await indexer.stop()
    })

    // ------------------------------------------------------------------------

    it('does not throw if add with rawtx mismatch', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, {}, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
      const otherTxid = 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'
      const options = { headers: { 'Content-Type': 'text/plain' } }
      await expect(axios.post(`http://localhost:${server.port}/tx/${txid}`, txns[otherTxid], options)).to.be.fulfilled
      server.stop()
      await indexer.stop()
    })
  })

  // --------------------------------------------------------------------------
  // post trust
  // --------------------------------------------------------------------------

  describe('post trust', () => {
    it('trust multiple', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, {}, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const trustlist = [
        '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64',
        'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'
      ]
      const options = { headers: { 'Content-Type': 'application/json' } }
      await axios.post(`http://localhost:${server.port}/trust`, trustlist, options)
      for (const txid of trustlist) {
        expect(await indexer.database.isTrusted(txid)).to.equal(true)
      }
      server.stop()
      await indexer.stop()
    })
  })

  // --------------------------------------------------------------------------
  // get jig
  // --------------------------------------------------------------------------

  describe('get jig', () => {
    it('returns state if exists', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const promise = indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await promise
      const location = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102_o1'
      const state = (await axios.get(`http://localhost:${server.port}/jig/${location}`)).data
      expect(typeof state).to.equal('object')
      expect(state.kind).to.equal('jig')
      server.stop()
      await indexer.stop()
    })

    // ------------------------------------------------------------------------

    it('returns 404 if missing', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const location = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102_o1'
      await expect(axios.get(`http://localhost:${server.port}/jig/${location}`)).to.be.rejectedWith(Error)
      try {
        await axios.get(`http://localhost:${server.port}/jig/${location}`)
      } catch (e) {
        expect(e.response.status).to.equal(404)
      }
      server.stop()
      await indexer.stop()
    })
  })

  // --------------------------------------------------------------------------
  // get berry
  // --------------------------------------------------------------------------

  describe('get berry', () => {
    it('returns state if exists', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      await database.addTransaction('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
      await indexed(indexer, 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
      const location = '24cde3638a444c8ad397536127833878ffdfe1b04d5595489bd294e50d77105a_o1?berry=2f3492ef5401d887a93ca09820dff952f355431cea306841a70d163e32b2acad&version=5'
      const state = (await axios.get(`http://localhost:${server.port}/berry/${encodeURIComponent(location)}`)).data
      expect(typeof state).to.equal('object')
      expect(state.kind).to.equal('berry')
      server.stop()
      await indexer.stop()
    })

    // ------------------------------------------------------------------------

    it('returns 404 if missing', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const location = '24cde3638a444c8ad397536127833878ffdfe1b04d5595489bd294e50d77105a_o1?berry=2f3492ef5401d887a93ca09820dff952f355431cea306841a70d163e32b2acad&version=5'
      await expect(axios.get(`http://localhost:${server.port}/berry/${location}`)).to.be.rejectedWith(Error)
      try {
        await axios.get(`http://localhost:${server.port}/berry/${location}`)
      } catch (e) {
        expect(e.response.status).to.equal(404)
      }
      server.stop()
      await indexer.stop()
    })
  })

  // --------------------------------------------------------------------------
  // get tx
  // --------------------------------------------------------------------------

  describe('get tx', () => {
    it('returns rawtx if downloaded', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const txid = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102'
      const promise = downloaded(indexer, txid)
      await database.addTransaction(txid)
      await promise
      const rawtx = (await axios.get(`http://localhost:${server.port}/tx/${txid}`)).data
      expect(typeof rawtx).to.equal('string')
      expect(rawtx.length).to.equal(2074)
      server.stop()
      await indexer.stop()
    })

    // ------------------------------------------------------------------------

    it('returns 404 if missing', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const txid = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102'
      await expect(axios.get(`http://localhost:${server.port}/tx/${txid}`)).to.be.rejectedWith(Error)
      try {
        await axios.get(`http://localhost:${server.port}/tx/${txid}`)
      } catch (e) {
        expect(e.response.status).to.equal(404)
      }
      server.stop()
      await indexer.stop()
    })

    // ------------------------------------------------------------------------

    it('returns 404 if not downloaded', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const txid = '1111111111111111111111111111111111111111111111111111111111111111'
      database.addTransaction(txid)
      await expect(axios.get(`http://localhost:${server.port}/tx/${txid}`)).to.be.rejectedWith(Error)
      try {
        await axios.get(`http://localhost:${server.port}/tx/${txid}`)
      } catch (e) {
        expect(e.response.status).to.equal(404)
      }
      server.stop()
      await indexer.stop()
    })
  })

  // --------------------------------------------------------------------------
  // get unspent
  // --------------------------------------------------------------------------

  describe('get unspent', () => {
    it('query all unspent', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const promise = indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await promise
      const unspent = (await axios.get(`http://localhost:${server.port}/unspent`)).data
      expect(unspent.length).to.equal(3)
      expect(unspent.includes('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64_o1')).to.equal(true)
      expect(unspent.includes('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64_o2')).to.equal(true)
      expect(unspent.includes('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102_o1')).to.equal(true)
      server.stop()
      await indexer.stop()
    })

    // ------------------------------------------------------------------------

    it('query unspent by address', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const promise = indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await promise
      const address = '1Kc8XRNryDycwvfEQiFF2TZwD1CVhgwGy2'
      const unspent = (await axios.get(`http://localhost:${server.port}/unspent?address=${address}`)).data
      expect(unspent.length).to.equal(3)
      server.stop()
      await indexer.stop()
    })
  })

  // --------------------------------------------------------------------------
  // misc
  // --------------------------------------------------------------------------

  describe('misc', () => {
    it('cors', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 'main', 1, logger, 0, Infinity, [])
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const opts = { headers: { Origin: 'https://www.google.com' } }
      const resp = (await axios.get(`http://localhost:${server.port}/status`, opts))
      expect(resp.headers['access-control-allow-origin']).to.equal('*')
      server.stop()
      await indexer.stop()
    })
  })
})

// ------------------------------------------------------------------------------------------------
