const { def, get } = require('bdd-lazy-var/getter')
const { Indexer, TrustAllTrustList, ExecutingSet } = require('../src')
const { buildDs, buildBlobs, buildExecutor } = require('./test-env')
const { PostIndexer } = require('../src/post-indexer')
const { MemoryQueue } = require('../src/queues/memory-queu')
const Run = require('run-sdk')
const { buildCounter } = require('./test-jigs/counter')
const { txidFromLocation } = require('../src/util/txid-from-location')
const { expect } = require('chai')
const { describe, it, beforeEach } = require('mocha')
const { buildContainer } = require('./test-jigs/container')

describe('PostIndexer', async () => {
  def('ds', () => buildDs())
  def('blobs', () => buildBlobs())
  def('trustList', () => new TrustAllTrustList())
  def('network', () => 'test')
  def('executor', () => buildExecutor(get.network, get.blobs, get.ds))
  def('execSet', () => new ExecutingSet(get.ds))
  def('logger', () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }))
  def('indexer', () => new Indexer(get.ds, get.blobs, get.trustList, get.executor, get.network, get.logger, []))

  def('execQueue', () => new MemoryQueue())

  def('run', () => new Run({ network: 'mock', cache: new Map() }))
  def('Counter', () => buildCounter())

  def('postIndexer', () => new PostIndexer(get.ds, get.logger))

  beforeEach(async () => {
    await get.ds.setUp()
    await get.blobs.setUp()
    await get.executor.start()
  })

  afterEach(async () => {
    await get.blobs.tearDown()
    await get.ds.tearDown()
    await get.executor.stop()
  })

  describe('when the tx was executed ok and there is no enablements', () => {
    def('tx', async () => {
      const run = get.run
      const Counter = get.Counter

      run.deploy(Counter)
      await run.sync()

      const txid = txidFromLocation(Counter.location)
      const buff = Buffer.from(await run.blockchain.fetch(txid), 'hex')
      return { buff, txid }
    })

    it('returns nothing to execute', async () => {
      const { txid, buff } = await get.tx

      await get.indexer.indexTransaction(buff)

      const result = await get.postIndexer.process(txid, true, true)
      expect(result.enablements).to.eql([])
      expect(result.deps).to.eql([])
    })
  })

  describe('when the tx was executed ok and there is one enablement', () => {
    it('returns nothing to execute', async () => {
      const run = get.run
      const Counter = buildCounter()
      run.deploy(Counter)
      await run.sync()

      const instance = new Counter()
      await instance.sync()

      const txid1 = txidFromLocation(Counter.location)
      const buff1 = Buffer.from(await run.blockchain.fetch(txid1), 'hex')
      const txid2 = txidFromLocation(instance.location)
      const buff2 = Buffer.from(await run.blockchain.fetch(txid2), 'hex')

      await get.indexer.indexTransaction(buff2)
      await get.indexer.indexTransaction(buff1)

      const result = await get.postIndexer.process(txid1, true, true)
      expect(result.enablements).to.eql([txid2])
      expect(result.deps).to.eql([])
    })
  })

  describe('when tx depens on an unknown tx', () => {
    def('txClass', async () => {
      const Counter = get.Counter
      get.run.deploy(Counter)
      await get.run.sync()

      const txid = txidFromLocation(Counter.location)
      const buff = Buffer.from(await get.run.blockchain.fetch(txid), 'hex')

      return { txid, buff }
    })

    def('instance', async () => {
      await get.txClass
      const Counter = get.Counter
      const instance = new Counter()
      await instance.sync()
      return instance
    })

    def('txInstance', async () => {
      const instance = await get.instance

      const txid = txidFromLocation(instance.location)
      const buff = Buffer.from(await get.run.blockchain.fetch(txid), 'hex')

      return { txid, buff }
    })

    beforeEach(async () => {
      const { buff } = await get.txInstance
      await get.indexer.indexTransaction(buff)
    })

    it('returns a non executed dep', async () => {
      const { txid: instanceTxid } = await get.txInstance
      const { txid: classTxid } = await get.txClass
      const result = await get.postIndexer.process(instanceTxid, false, false)
      expect(result.enablements).to.eql([])
      expect(result.deps).to.eql([classTxid])
    })
  })

  describe('when tx depens on an known but unexecuted tx', () => {
    def('txClass', async () => {
      const Counter = get.Counter
      get.run.deploy(Counter)
      await get.run.sync()

      const txid = txidFromLocation(Counter.location)
      const buff = Buffer.from(await get.run.blockchain.fetch(txid), 'hex')

      return { txid, buff }
    })

    def('instance', async () => {
      await get.txClass
      const Counter = get.Counter
      const instance = new Counter()
      await instance.sync()
      return instance
    })

    def('txInstance', async () => {
      const instance = await get.instance

      const txid = txidFromLocation(instance.location)
      const buff = Buffer.from(await get.run.blockchain.fetch(txid), 'hex')

      return { txid, buff }
    })

    def('txMethod', async () => {
      const instance = await get.instance
      instance.inc()
      await instance.sync()

      const txid = txidFromLocation(instance.location)
      const buff = Buffer.from(await get.run.blockchain.fetch(txid), 'hex')

      return { txid, buff }
    })

    beforeEach(async () => {
      const { buff: buffInstance } = await get.txInstance
      const { buff: buffMethod } = await get.txMethod
      await get.indexer.indexTransaction(buffInstance)
      await get.indexer.indexTransaction(buffMethod)
    })

    it('returns 2 deps to execute', async () => {
      const { txid: classTxid } = await get.txClass
      const { txid: instanceTxid } = await get.txInstance
      const { txid: methodTxid } = await get.txMethod
      const result = await get.postIndexer.process(methodTxid, false, false)
      expect(result.enablements).to.eql([])
      expect(result.deps).to.have.members([classTxid, instanceTxid])
    })

    it('returns only the non executed ones', async () => {
      const { buff } = await get.txClass
      const { txid: instanceTxid } = await get.txInstance
      const { txid: methodTxid } = await get.txMethod

      await get.indexer.indexTransaction(buff)
      const result = await get.postIndexer.process(methodTxid, false, false)

      expect(result.enablements).to.eql([])
      // expect(result.deps).to.have.length(1)
      expect(result.deps).to.have.members([instanceTxid])
    })
  })

  describe.skip('when there is 2 txs downstream, one enabled and another one not enabled', () => {
    def('tx1', async () => {
      const Container = buildContainer()
      get.run.deploy(Container)
      await get.run.sync()
      const txid = txidFromLocation(Container.location)
      const hex = await get.run.blockchain.fetch(txid)

      return { Container, tx: { txid, buff: Buffer.from(hex, 'hex') } }
    })
    def('tx2', async () => {
      const { Container } = await get.tx1
      const instance = new Container('holu')
      await instance.sync()

      const txid = txidFromLocation(instance.location)
      const hex = await get.run.blockchain.fetch(txid)

      return { instance, tx: { txid, buff: Buffer.from(hex, 'hex') } }
    })

    def('txDep', async () => {
      const Counter = await get.Counter
      const instance = new Counter()
      await instance.sync()

      const txid = txidFromLocation(instance.location)
      const hex = await get.run.blockchain.fetch(txid)

      return { instance, tx: { txid, buff: Buffer.from(hex, 'hex') } }
    })

    def('tx3', async () => {
      const { Container } = await get.tx1
      const { instance: aCounter } = await get.txDep
      const instance = new Container(aCounter)
      await instance.sync()

      const txid = txidFromLocation(instance.location)
      const hex = await get.run.blockchain.fetch(txid)

      return { instance, tx: { txid, buff: Buffer.from(hex, 'hex') } }
    })

    it('only queues only the enabled one', async () => {
      const { tx: tx1 } = await get.tx1
      const { tx: tx2 } = await get.tx2
      const { tx: txDep } = await get.txDep
      const { tx: tx3 } = await get.tx3

      await get.indexer.trust(tx1.txid)

      expect(await get.ds.txIsExecuted(txidFromLocation((await get.Counter).location))).to.eql(false)

      await get.indexer.indexTransaction(await tx2.buff, null)
      await get.indexer.indexTransaction(await tx3.buff, null)
      await get.indexer.indexTransaction(await txDep.buff, null)

      const response = await get.indexer.indexTransaction(await tx1.buff, null)
      expect(response.enables).to.eql([tx2.txid])
    })
  })

  describe.skip('when the tx enables the execution of another tx', () => {
    def('txHex', async () => {
      const Counter = await get.Counter
      const txid = Counter.location.split('_')[0]
      return get.run.blockchain.fetch(txid)
    })

    def('instance', async () => {
      const Counter = await get.Counter
      const instance = new Counter()
      await instance.sync()
      return instance
    })

    def('txHex2', async () => {
      const txid = (await get.instance).location.split('_')[0]
      return get.run.blockchain.fetch(txid)
    })

    def('txBuf2', async () => {
      const hex = await get.txHex2
      return Buffer.from(hex, 'hex')
    })

    beforeEach(async () => {
      const Counter = await get.Counter

      await get.indexer.trust(Counter.location.split('_')[0])
      await get.indexer.indexTransaction(await get.txBuf2, null)
    })

    it('executes immediately', async () => {
      const response = await get.indexer.indexTransaction(await get.txBuf, null, null)

      expect(response.executed).to.eql(true)
    })

    it('returns right enablements list', async () => {
      const instance = await get.instance
      const response = await get.indexer.indexTransaction(await get.txBuf, null, null)

      const txid = instance.location.split('_')[0]
      expect(response.enables).to.eql([txid])
    })

    it('returns right enablement list', async () => {
      const instance = await get.instance
      const response = await get.indexer.indexTransaction(await get.txBuf, null, null)

      const txid = instance.location.split('_')[0]
      expect(response.enables).to.eql([txid])
    })
  })
})
