/**
 * crawler.test.js
 *
 * Tests for the crawler and APIs it uses
 */

const { describe, it, beforeEach, afterEach } = require('mocha')
const { expect } = require('chai')
const Indexer = require('../src/indexer')
const txns = require('./txns.json')
const { DEFAULT_TRUSTLIST } = require('../src/config')
const Database = require('../src/database')
const { DbTrustList } = require('../src/trust-list/db-trust-list')
const Executor = require('../src/execution/executor')
const { KnexDatasource } = require('../src/data-sources/knex-datasource')
const knex = require('knex')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const fetch = txid => { return { hex: require('./txns.json')[txid] } }
const indexed = (indexer, txid) => new Promise((resolve) => { indexer.onIndex = x => txid === x && resolve() })
const crawled = (indexer) => new Promise((resolve) => { indexer.onBlock = height => resolve(height) })
const reorged = (indexer) => new Promise((resolve) => { indexer.onReorg = newHeight => resolve(newHeight) })
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

// ------------------------------------------------------------------------------------------------
// Crawler
// ------------------------------------------------------------------------------------------------

describe('Crawler', () => {
  let knexInstance
  let ds
  let trustList
  let database

  beforeEach(async () => {
    knexInstance = knex({
      client: 'better-sqlite3',
      connection: {
        filename: ':memory:'
      },
      migrations: {
        directory: 'db-migrations'
      }
    })
    ds = new KnexDatasource(knexInstance, logger, false)
    trustList = new DbTrustList(ds)
    database = new Database(ds, trustList, logger)

    await knexInstance.migrate.latest()
    await database.open()
  })
  afterEach(async () => {
    await database.close()
  })

  it('add txids', async () => {
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    function getNextBlock (_height, _hash) {
      return { height: 1, hash: 'abc', txids: [txid] }
    }
    const api = { getNextBlock, fetch }
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, [])
    const promise = indexed(indexer, txid)
    await indexer.start()
    await database.trust(txid)
    await promise
    await indexer.stop()
    expect(await database.getHeight()).to.equal(1)
    expect(await database.getHash()).to.equal('abc')
  })

  // --------------------------------------------------------------------------

  it('add block', async () => {
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    function getNextBlock (_height, _hash) {
      return { height: 1, hash: 'abc', txids: [txid], txhexs: [txns[txid]] }
    }
    const api = { getNextBlock }
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    await database.trust(txid)
    await indexed(indexer, txid)
    await indexer.stop()
    expect(await database.getHeight()).to.equal(1)
    expect(await database.getHash()).to.equal('abc')
  })

  // --------------------------------------------------------------------------

  it('add block with already downloaded transactions', async () => {
    const txids = [
      '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64',
      'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d',
      'ca9555f54dd44457d7c912e8eea375a8ed6d8ea1806a206b43af5c7f94ea47e7'
    ]
    let indexedMiddleTransaction = false
    function getNextBlock (height, _hash) {
      if (!indexedMiddleTransaction) return null
      if (height === 1) return null
      return { height: 1, hash: 'abc', txids, txhexs: txids.map(txid => txns[txid]) }
    }
    const api = { getNextBlock, fetch }
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
    indexer.crawler.pollForNewBlocksInterval = 10
    const promise1 = indexed(indexer, txids[1])
    await indexer.start()
    await database.addTransaction(txids[1])
    await database.trust(txids[0])
    await database.trust(txids[1])
    await database.trust(txids[2])
    await promise1
    indexedMiddleTransaction = true
    await indexed(indexer, txids[0])
    await indexer.stop()
    expect(await database.getTransactionHex(txids[0])).to.equal(txns[txids[0]])
    expect(await database.getTransactionHex(txids[1])).to.equal(txns[txids[1]])
    expect(await database.getTransactionHex(txids[2])).to.equal(txns[txids[2]])
  })

  // --------------------------------------------------------------------------

  it('reorg blocks', async () => {
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    let didReorg = false
    let didIndex = false
    function getNextBlock (height, _hash) {
      if (didReorg) return { height: 3, hash: 'def', txids: [] }
      if (height < 5) return { height: height + 1, hash: 'abc' + height, txids: [] }
      if (height === 5) return { height: height + 1, hash: 'abc', txids: [txid] }
      if (height < 12) return { height: height + 1, hash: 'abc' + height, txids: [] }
      if (!didIndex) { return null }
      if (height === 12) { didReorg = true; return { reorg: true } }
    }
    const api = { getNextBlock, fetch }
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, [])
    indexer.crawler.pollForNewBlocksInterval = 10
    await indexer.start()
    database.trust(txid)
    await indexed(indexer, txid)
    didIndex = true
    await reorged(indexer)
    expect(await indexer.database.getHeight()).to.equal(2)
    await crawled(indexer, 3)
    expect(await database.getHeight()).to.equal(3)
    expect(await database.getHash()).to.equal('def')
    expect(await database.getTransactionHex(txid)).not.to.equal(undefined)
    expect(await database.getJigState(txid + '_o1')).not.to.equal(undefined)
    expect(await database.getTransactionHeight(txid)).to.equal(-1)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('keeps the states after a reorg', async () => {
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    let didReorg = false
    function getNextBlock (height, _hash) {
      if (didReorg) return { height: 3, hash: 'def', txids: [] }
      if (height < 5) return { height: height + 1, hash: 'abc' + height, txids: [] }
      if (height === 5) return { height: height + 1, hash: 'abc', txids: [txid] }
      if (height < 12) return { height: height + 1, hash: 'abc' + height, txids: [] }
      if (height === 12) { didReorg = true; return { reorg: true } }
    }
    const api = { getNextBlock, fetch }
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    await database.trust(txid)
    await reorged(indexer)
    await indexed(indexer, txid)
    await indexer.stop()
    expect(await database.getTransactionHex(txid)).not.to.equal(undefined)
    const state = await database.getJigState(txid + '_o1')
    expect(state.props.origin).to.equal('_o1')
    expect(state.src).to.match(/class Dragon/)
    expect(await database.getTransactionHeight(txid)).to.equal(-1)
  })
})
