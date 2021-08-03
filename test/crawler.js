/**
 * crawler.js
 *
 * Tests for the crawler and APIs it uses
 */

const { describe, it, beforeEach, afterEach } = require('mocha')
const { expect } = require('chai')
const Indexer = require('../src/indexer')
const txns = require('./txns.json')
const { DEFAULT_TRUSTLIST } = require('../src/config')
const Database = require('../src/database')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const fetch = txid => { return { hex: require('./txns.json')[txid] } }
const indexed = (indexer, txid) => new Promise((resolve, reject) => { indexer.onIndex = x => txid === x && resolve() })
const crawled = (indexer) => new Promise((resolve, reject) => { indexer.onBlock = height => resolve(height) })
const reorged = (indexer) => new Promise((resolve, reject) => { indexer.onReorg = newHeight => resolve(newHeight) })
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
const database = new Database(':memory:', logger, false)

beforeEach(() => database.open())
afterEach(() => database.close())

// ------------------------------------------------------------------------------------------------
// Crawler
// ------------------------------------------------------------------------------------------------

describe('Crawler', () => {
  it('add txids', async () => {
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    function getNextBlock (height, hash) {
      return { height: 1, hash: 'abc', txids: [txid] }
    }
    const api = { getNextBlock, fetch }
    const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    database.trust(txid)
    await indexed(indexer, txid)
    expect(database.getHeight()).to.equal(1)
    expect(database.getHash()).to.equal('abc')
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('add block', async () => {
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    function getNextBlock (height, hash) {
      return { height: 1, hash: 'abc', txids: [txid], txhexs: [txns[txid]] }
    }
    const api = { getNextBlock }
    const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    database.trust(txid)
    await indexed(indexer, txid)
    expect(database.getHeight()).to.equal(1)
    expect(database.getHash()).to.equal('abc')
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('add block with already downloaded transactions', async () => {
    const txids = [
      '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64',
      'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d',
      'ca9555f54dd44457d7c912e8eea375a8ed6d8ea1806a206b43af5c7f94ea47e7'
    ]
    let indexedMiddleTransaction = false
    function getNextBlock (height, hash) {
      if (!indexedMiddleTransaction) return null
      if (height === 1) return null
      return { height: 1, hash: 'abc', txids, txhexs: txids.map(txid => txns[txid]) }
    }
    const api = { getNextBlock, fetch }
    const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
    indexer.crawler.pollForNewBlocksInterval = 10
    await indexer.start()
    await database.addTransaction(txids[1])
    database.trust(txids[0])
    database.trust(txids[1])
    database.trust(txids[2])
    await indexed(indexer, txids[1])
    indexedMiddleTransaction = true
    await indexed(indexer, txids[0])
    expect(database.getTransactionHex(txids[0])).to.equal(txns[txids[0]])
    expect(database.getTransactionHex(txids[1])).to.equal(txns[txids[1]])
    expect(database.getTransactionHex(txids[2])).to.equal(txns[txids[2]])
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('reorg blocks', async () => {
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    let didReorg = false
    let didIndex = false
    function getNextBlock (height, hash) {
      if (didReorg) return { height: 3, hash: 'def', txids: [] }
      if (height < 5) return { height: height + 1, hash: 'abc' + height, txids: [] }
      if (height === 5) return { height: height + 1, hash: 'abc', txids: [txid] }
      if (height < 12) return { height: height + 1, hash: 'abc' + height, txids: [] }
      if (!didIndex) { return null }
      if (height === 12) { didReorg = true; return { reorg: true } }
    }
    const api = { getNextBlock, fetch }
    const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
    indexer.crawler.pollForNewBlocksInterval = 10
    await indexer.start()
    database.trust(txid)
    await indexed(indexer, txid)
    didIndex = true
    await reorged(indexer)
    expect(indexer.database.getHeight()).to.equal(2)
    await crawled(indexer, 3)
    expect(database.getHeight()).to.equal(3)
    expect(database.getHash()).to.equal('def')
    expect(database.getTransactionHex(txid)).not.to.equal(undefined)
    expect(database.getJigState(txid + '_o1')).not.to.equal(undefined)
    expect(database.getTransactionHeight(txid)).to.equal(-1)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('reorg while executing', async () => {
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    let didReorg = false
    function getNextBlock (height, hash) {
      if (didReorg) return { height: 3, hash: 'def', txids: [] }
      if (height < 5) return { height: height + 1, hash: 'abc' + height, txids: [] }
      if (height === 5) return { height: height + 1, hash: 'abc', txids: [txid] }
      if (height < 12) return { height: height + 1, hash: 'abc' + height, txids: [] }
      if (height === 12) { didReorg = true; return { reorg: true } }
    }
    const api = { getNextBlock, fetch }
    const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    database.trust(txid)
    await reorged(indexer)
    expect(database.getTransactionHex(txid)).not.to.equal(undefined)
    expect(database.getJigState(txid + '_o1')).to.equal(undefined)
    expect(database.getTransactionHeight(txid)).to.equal(-1)
    await indexer.stop()
  })
})

// ------------------------------------------------------------------------------------------------
