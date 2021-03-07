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

const listening = (server) => new Promise((resolve, reject) => { server.onListening = () => resolve() })
const indexed = (indexer, txid) => new Promise((resolve, reject) => { indexer.onIndex = x => txid === x && resolve() })

// ------------------------------------------------------------------------------------------------
// Server
// ------------------------------------------------------------------------------------------------

describe('Server', () => {
  it('adds with body', async () => {
    const indexer = new Indexer(':memory:', {}, 'main', 1, 1, null, 0, Infinity)
    const server = new Server(indexer, null, null)
    indexer.start()
    server.start()
    await listening(server)
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    const options = { headers: { 'Content-Type': 'text/plain' } }
    await axios.post(`http://localhost:${server.port}/tx/${txid}`, txns[txid], options)
    await axios.post(`http://localhost:${server.port}/trust/${txid}`)
    await indexed(indexer, txid)
    server.stop()
    indexer.stop()
  })

  // ------------------------------------------------------------------------

  it('throws if add with rawtx mismatch', async () => {
    const indexer = new Indexer(':memory:', {}, 'main', 1, 1, null, 0, Infinity)
    const server = new Server(indexer, null, null)
    indexer.start()
    server.start()
    await listening(server)
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    const otherTxid = 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'
    const options = { headers: { 'Content-Type': 'text/plain' } }
    await expect(axios.post(`http://localhost:${server.port}/tx/${txid}`, txns[otherTxid], options)).to.be.rejected
    server.stop()
    indexer.stop()
  })

  // ------------------------------------------------------------------------

  it('trust multiple', async () => {
    const indexer = new Indexer(':memory:', {}, 'main', 1, 1, null, 0, Infinity)
    const server = new Server(indexer, null, null)
    indexer.start()
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
    indexer.stop()
  })
})

// ------------------------------------------------------------------------------------------------
