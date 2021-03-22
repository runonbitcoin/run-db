/**
 * server.js
 *
 * Tests for src/server.js
 */

const { describe, it } = require('mocha')
require('chai').use(require('chai-as-promised'))
const { expect } = require('chai')
const axios = require('axios')
const Indexer = require('../src/indexer')
const Server = require('../src/server')
const txns = require('./txns.json')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const fetch = txid => { return { hex: require('./txns.json')[txid] } }
const api = { fetch }
const indexed = (indexer, txid) => new Promise((resolve, reject) => { indexer.onIndex = x => txid === x && resolve() })
const listening = (server) => new Promise((resolve, reject) => { server.onListening = () => resolve() })

// ------------------------------------------------------------------------------------------------
// Server
// ------------------------------------------------------------------------------------------------

describe('Server', () => {
  // --------------------------------------------------------------------------
  // post tx
  // --------------------------------------------------------------------------

  describe('post tx', () => {
    it('add with body', async () => {
      const indexer = new Indexer(':memory:', {}, 'main', 1, 1, null, 0, Infinity)
      const server = new Server(indexer, null, null)
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

    it('throws if add with rawtx mismatch', async () => {
      const indexer = new Indexer(':memory:', {}, 'main', 1, 1, null, 0, Infinity)
      const server = new Server(indexer, null, null)
      await indexer.start()
      server.start()
      await listening(server)
      const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
      const otherTxid = 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'
      const options = { headers: { 'Content-Type': 'text/plain' } }
      await expect(axios.post(`http://localhost:${server.port}/tx/${txid}`, txns[otherTxid], options)).to.be.rejected
      server.stop()
      await indexer.stop()
    })
  })

  // --------------------------------------------------------------------------
  // post trust
  // --------------------------------------------------------------------------

  describe('post trust', () => {
    it('trust multiple', async () => {
      const indexer = new Indexer(':memory:', {}, 'main', 1, 1, null, 0, Infinity)
      const server = new Server(indexer, null, null)
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
    it('exists', async () => {
      const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0, Infinity)
      const server = new Server(indexer, null, null)
      await indexer.start()
      server.start()
      indexer.add('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      const location = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102_o1'
      const state = (await axios.get(`http://localhost:${server.port}/jig/${location}`)).data
      expect(typeof state).to.equal('object')
      expect(state.kind).to.equal('jig')
      server.stop()
      await indexer.stop()
    })
  })

  // --------------------------------------------------------------------------
  // get unspent
  // --------------------------------------------------------------------------

  describe('get unspent', () => {
    it('query all unspent', async () => {
      const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0, Infinity)
      const server = new Server(indexer, null, null)
      await indexer.start()
      server.start()
      indexer.add('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
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
      const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0, Infinity)
      const server = new Server(indexer, null, null)
      await indexer.start()
      server.start()
      indexer.add('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      const address = '1Kc8XRNryDycwvfEQiFF2TZwD1CVhgwGy2'
      const unspent = (await axios.get(`http://localhost:${server.port}/unspent?address=${address}`)).data
      expect(unspent.length).to.equal(3)
      server.stop()
      await indexer.stop()
    })
  })
})

// ------------------------------------------------------------------------------------------------
