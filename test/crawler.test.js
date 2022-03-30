/**
 * crawler.test.js
 *
 * Tests for the crawler and APIs it uses
 */

const { describe, it, beforeEach, afterEach } = require('mocha')
const { expect } = require('chai')
const { def, get } = require('bdd-lazy-var/getter')
const Indexer = require('../src/indexer')
const txns = require('./txns.json')
const { DEFAULT_TRUSTLIST } = require('../src/config')
const { DbTrustList } = require('../src/trust-list/db-trust-list')
const Executor = require('../src/execution/executor')
const { KnexDatasource } = require('../src/data-sources/knex-datasource')
const knex = require('knex')
const { KnexBlobStorage } = require('../src/data-sources/knex-blob-storage')
const Crawler = require('../src/crawler')
const { TestBlockchainApi } = require('../src/blockchain-api/test-blockchain-api')
const Run = require('run-sdk')

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
  def('ds', () => {
    const knexInstance = knex({
      client: 'sqlite3',
      connection: {
        filename: 'file:memDbMain?mode=memory&cache=shared',
        flags: ['OPEN_URI', 'OPEN_SHAREDCACHE']
      },
      migrations: {
        tableName: 'migrations',
        directory: 'db-migrations'
      },
      useNullAsDefault: true
    })

    return new KnexDatasource(knexInstance, logger, false)
  })

  def('trustList', () => {
    return new DbTrustList()
  })

  def('blobs', () => {
    const blobsKnex = knex({
      client: 'sqlite3',
      connection: {
        filename: 'file:memDbBlobs?mode=memory&cache=shared',
        flags: ['OPEN_URI', 'OPEN_SHAREDCACHE']
      },
      migrations: {
        tableName: 'migrations',
        directory: 'blobs-migrations'
      },
      useNullAsDefault: true
    })

    return new KnexBlobStorage(blobsKnex, {
      serialize: JSON.stringify,
      deserialize: JSON.parse
    })
  })

  def('network', () => 'test')

  def('executor', () => {
    return new Executor(get.network, 1, get.blobs, get.ds, logger, {})
  })

  def('indexer', () => {
    return new Indexer(null, get.ds, get.blobs, get.trustList, get.executor, get.network, logger)
  })

  def('api', () => {
    return new TestBlockchainApi()
  })

  def('crawler', () => {
    return new Crawler(get.indexer, get.api, get.ds, logger)
  })

  def('run', () => new Run({ network: 'mock', cache: new Map() }))

  def('someRunTx', async () => {
    class Counter extends Run.Jig {}
    get.run.deploy(Counter)
    await get.run.sync()
    const txid = Counter.location.split('_')[0]
    const hex = await get.run.blockchain.fetch(txid)
    return { txid, hex, buff: Buffer.from(hex, 'hex') }
  })

  def('anotherRunTx', async () => {
    class AnotherClass extends Run.Jig {}
    get.run.deploy(AnotherClass)
    await get.run.sync()
    const txid = AnotherClass.location.split('_')[0]
    const hex = await get.run.blockchain.fetch(txid)
    return { txid, hex, buff: Buffer.from(hex, 'hex') }
  })

  def('childRunTx', async () => {
    const [Counter] = get.run.inventory.code.filter(c => c.name === 'Counter')
    const instance = new Counter()
    await instance.sync()
    const txid = instance.location.split('_')[0]
    const hex = await get.run.blockchain.fetch(txid)
    return { txid, hex, buff: Buffer.from(hex, 'hex') }
  })

  beforeEach(async () => {
    await get.ds.setUp()
    await get.ds.knex.migrate.latest()
    await get.blobs.knex.migrate.latest()
    await get.executor.start()
  })

  afterEach(async () => {
    await get.executor.stop()
    await get.ds.tearDown()
    await get.blobs.knex.destroy()
  })

  it('indexes a tx that arrives from the mempool', async () => {
    const { txid, buff } = await get.someRunTx
    await get.indexer.trust(txid)

    await get.crawler.start()

    get.api.newMempoolTx(txid, buff)
    await get.api.waitForall()
    const txWasIndexed = await get.ds.txIsIndexed(txid)
    expect(txWasIndexed).to.eql(true)
  })

  describe('when indexing a block', () => {
    beforeEach(async () => {
      const { txid: txid1, buff: buff1 } = await get.someRunTx
      const { txid: txid2, buff: buff2 } = await get.childRunTx

      await get.indexer.trust(txid1)
      get.api.newMempoolTx(txid1, buff1)
      get.api.newMempoolTx(txid2, buff2)
    })

    it('indexes the transactions in the block', async () => {
      await get.crawler.start()
      get.api.closeBlock('blockhash1')
      await get.api.waitForall()
      const { txid: txid1 } = await get.someRunTx
      const { txid: txid2 } = await get.childRunTx
      const tx1WasIndexed = await get.ds.txIsIndexed(txid1)
      const tx2WasIndexed = await get.ds.txIsIndexed(txid2)
      expect(tx1WasIndexed).to.eql(true)
      expect(tx2WasIndexed).to.eql(true)
    })

    it('increases the crawl', async () => {
      await get.crawler.start()
      get.api.closeBlock('blockhash1')
      await get.api.waitForall()

      const height = await get.ds.getCrawlHeight()
      const hash = await get.ds.getCrawlHash()
      expect(height).to.eql(1)
      expect(hash).to.eql('blockhash1')
    })

    describe('when the are missing blocks between the latest known and the new block', function () {
      // beforeEach(async () => {
      //
      // })

      it('searchs for the middle blocks', async () => {
        await get.crawler.start()
        get.api.closeBlock('blockhash1')
        const { txid, buff } = await get.anotherRunTx
        const old1 = get.api._onNewBlock
        const old2 = get.api._onNewMempoolTx
        await get.indexer.trust(txid)
        get.api.onNewBlock(async () => {})
        get.api.onMempoolTx(async () => {})
        get.api.closeBlock('empty1')
        get.api.newMempoolTx(txid, buff)
        await get.api.waitForall()
        get.api.closeBlock('nonempty')

        // get.api.closeBlock('empty2')
        get.api.onNewBlock(old1)
        get.api.onMempoolTx(old2)
        get.api.closeBlock('empty2')
        await get.api.waitForall()

        const tx1WasIndexed = await get.ds.txIsIndexed(txid)
        expect(tx1WasIndexed).to.eql(true)
      })
    })
  })

  describe('#start', async () => {
    it('when its behind of the real tip it keeps up when starting', async () => {
      const tx1 = await get.someRunTx
      const tx2 = await get.anotherRunTx
      get.api.newMempoolTx(tx1.txid, tx1.buff)
      get.api.closeBlock('nonEmpty')
      get.api.closeBlock('firstEmpty')
      get.api.closeBlock('secondEmpty')
      get.api.newMempoolTx(tx2.txid, tx2.buff)
      get.api.closeBlock('tipNonEmpty')

      await get.indexer.trust(tx1.txid)
      await get.indexer.trust(tx2.txid)
      await get.crawler.start()

      const tx1WasIndexed = await get.ds.txIsIndexed(tx1.txid)
      const tx2WasIndexed = await get.ds.txIsIndexed(tx2.txid)
      expect(tx1WasIndexed).to.eql(true)
      expect(tx2WasIndexed).to.eql(true)
    })

    it('when it already knows a tip it does not look for previous blocks', async () => {
      const tx1 = await get.someRunTx
      const tx2 = await get.anotherRunTx
      get.api.newMempoolTx(tx1.txid, tx1.buff)
      get.api.closeBlock('nonEmpty')
      get.api.closeBlock('firstEmpty')
      get.api.closeBlock('secondEmpty')
      get.api.newMempoolTx(tx2.txid, tx2.buff)
      get.api.closeBlock('tipNonEmpty')

      await get.indexer.trust(tx1.txid)
      await get.indexer.trust(tx2.txid)
      await get.crawler.setTip('firstEmpty')
      await get.crawler.start()

      const tx1WasIndexed = await get.ds.txIsIndexed(tx1.txid)
      const tx2WasIndexed = await get.ds.txIsIndexed(tx2.txid)
      expect(tx1WasIndexed).to.eql(false)
      expect(tx2WasIndexed).to.eql(true)
    })
  })

  it.skip('add txids', async () => {
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

  it.skip('add block', async () => {
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

  it.skip('add block with already downloaded transactions', async () => {
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

  it.skip('reorg blocks', async () => {
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

  it.skip('keeps the states after a reorg', async () => {
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
