/**
 * server.js
 *
 * Tests for src/server.js
 */

const { describe, it, beforeEach, afterEach } = require('mocha')
require('chai').use(require('chai-as-promised'))
const { expect } = require('chai')
const axios = require('axios')
const Indexer = require('../src/indexer')
const Server = require('../src/server')
const txns = require('./txns.json')
const { DEFAULT_TRUSTLIST } = require('../src/config')
const Database = require('../src/database')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const fetch = async txid => { return { hex: require('./txns.json')[txid] } }
const api = { fetch }
const downloaded = (indexer, txid) => new Promise((resolve, reject) => { indexer.onDownload = x => txid === x && resolve() })
const indexed = (indexer, txid) => new Promise((resolve, reject) => { indexer.onIndex = x => txid === x && resolve() })
const listening = (server) => new Promise((resolve, reject) => { server.onListening = () => resolve() })
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
const database = new Database(':memory:', logger, false)

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
      const indexer = new Indexer(database, {}, 'main', 1, 1, logger, 0, Infinity, [])
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
      const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
      const options = { headers: { 'Content-Type': 'text/plain' } }
      await axios.post(`http://localhost:${server.port}/tx/${txid}`, txns[txid], options)
      await axios.post(`http://localhost:${server.port}/trust/${txid}`)
      await indexed(indexer, txid)
      server.stop()
      await indexer.stop()
    })

    // ------------------------------------------------------------------------

    it('does not throw if add with rawtx mismatch', async () => {
      // Because the "POST /tx/:txid" endpoint is being deprecated we are not doing this
      // checking anymore. The txid of the url is ignored.
      const indexer = new Indexer(database, {}, 'main', 1, 1, logger, 0, Infinity, [])
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
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
      const indexer = new Indexer(database, {}, 'main', 1, 1, logger, 0, Infinity, [])
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
      const trustlist = [
        '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64',
        'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'
      ]
      const options = { headers: { 'Content-Type': 'application/json' } }
      await axios.post(`http://localhost:${server.port}/trust`, trustlist, options)
      trustlist.forEach(txid => expect(indexer.database.isTrusted(txid)).to.equal(true))
      server.stop()
      await indexer.stop()
    })
  })

  // --------------------------------------------------------------------------
  // get jig
  // --------------------------------------------------------------------------

  describe('get jig', () => {
    it('returns state if exists', async () => {
      const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
      database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      const location = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102_o1'
      const state = (await axios.get(`http://localhost:${server.port}/jig/${location}`)).data
      expect(typeof state).to.equal('object')
      expect(state.kind).to.equal('jig')
      server.stop()
      await indexer.stop()
    })

    // ------------------------------------------------------------------------

    it('returns 404 if missing', async () => {
      const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
      const location = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102_o1'
      await expect(axios.get(`http://localhost:${server.port}/jig/${location}`)).to.be.rejected
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
      const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
      database.addTransaction('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
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
      const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
      const location = '24cde3638a444c8ad397536127833878ffdfe1b04d5595489bd294e50d77105a_o1?berry=2f3492ef5401d887a93ca09820dff952f355431cea306841a70d163e32b2acad&version=5'
      await expect(axios.get(`http://localhost:${server.port}/berry/${location}`)).to.be.rejected
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
      const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
      const txid = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102'
      database.addTransaction(txid)
      await downloaded(indexer, txid)
      const rawtx = (await axios.get(`http://localhost:${server.port}/tx/${txid}`)).data
      expect(typeof rawtx).to.equal('string')
      expect(rawtx.length).to.equal(2074)
      server.stop()
      await indexer.stop()
    })

    // ------------------------------------------------------------------------

    it('returns 404 if missing', async () => {
      const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
      const txid = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102'
      await expect(axios.get(`http://localhost:${server.port}/tx/${txid}`)).to.be.rejected
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
      const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
      const txid = '1111111111111111111111111111111111111111111111111111111111111111'
      database.addTransaction(txid)
      await expect(axios.get(`http://localhost:${server.port}/tx/${txid}`)).to.be.rejected
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
      const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
      database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
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
      const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
      database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
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
      const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
      const server = new Server(database, logger, null)
      await indexer.start()
      server.start()
      await listening(server)
      const opts = { headers: { Origin: 'https://www.google.com' } }
      const resp = (await axios.get(`http://localhost:${server.port}/status`, opts))
      expect(resp.headers['access-control-allow-origin']).to.equal('*')
      server.stop()
      await indexer.stop()
    })
  })
})

// ------------------------------------------------------------------------------------------------
