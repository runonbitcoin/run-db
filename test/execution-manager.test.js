const { expect } = require('chai')
const { get, def } = require('bdd-lazy-var/getter')
const { DbTrustList } = require('../src/trust-list/db-trust-list')
const Indexer = require('../src/indexer')
const { TestBlockchainApi } = require('../src/blockchain-api/test-blockchain-api')
const Run = require('run-sdk')
const { beforeEach, afterEach } = require('mocha')
const { ExecutionManager } = require('../src/execution-manager')
const { MemoryQueue } = require('../src/queues/memory-queu')
const { ExecutionWorker } = require('../src/execution-worker')
const { buildDs, buildBlobs, buildExecutor } = require('./test-env')
const { ExecutingSet } = require('../src/executing-set')
const { ExecutionResult } = require('../src/model/execution-result')

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

describe('ExecutionManager', () => {
  def('ds', () => buildDs())

  def('trustList', () => {
    return new DbTrustList(get.ds)
  })

  def('blobs', buildBlobs)

  def('network', () => 'test')

  def('executor', () => buildExecutor(get.network, get.blobs, get.ds))
  def('indexer', () => {
    return new Indexer(get.ds, get.blobs, get.trustList, get.executor, get.network, logger)
  })

  def('api', () => {
    return new TestBlockchainApi()
  })

  def('run', () => new Run({ network: 'mock', cache: new Map() }))

  def('execQueue', () => new MemoryQueue())
  def('trustQueue', () => new MemoryQueue())
  def('postIndexQueue', () => new MemoryQueue())
  def('execSet', () => new ExecutingSet(get.ds))
  def('manager', () => new ExecutionManager(get.blobs, get.execQueue, get.trustQueue, get.execSet))

  beforeEach(async () => {
    await get.ds.setUp()
    await get.ds.knex.migrate.latest()
    await get.blobs.knex.migrate.latest()
    await get.executor.start()
  })

  afterEach(async () => {
    await get.execQueue.tearDown()
    await get.trustQueue.tearDown()
    await get.executor.stop()
    await get.ds.tearDown()
    await get.blobs.knex.destroy()
    await get.indexer.stop()
    await get.manager.tearDown()
  })

  def('someRunTx', async () => {
    class Counter extends Run.Jig {}

    get.run.deploy(Counter)
    await get.run.sync()
    const txid = Counter.location.split('_')[0]
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

  def('worker', () => {
    return new ExecutionWorker(get.indexer, get.execSet, get.execQueue, get.trustQueue, get.postIndexQueue)
  })

  let emptyQueue
  beforeEach(async () => {
    const tx = await get.someRunTx
    await get.indexer.trust(tx.txid)
    emptyQueue = new Promise(resolve => get.execQueue.onEmpty(resolve))
    await get.worker.setUp()
  })

  afterEach(async () => {
    await get.worker.tearDown()
  })

  it('executes a single tx', async () => {
    const tx = await get.someRunTx
    await get.manager.indexTxNow(tx.buff)
    expect(await get.ds.txIsIndexed(tx.txid)).to.eql(true)
  })

  describe('when the tx release an enablement', async () => {
    beforeEach(async () => {
      const childTx = await get.childRunTx
      await get.indexer.indexTransaction(childTx.buff)
      // await get.manager.setUp()
    })

    it('executes the tx', async () => {
      const tx = await get.someRunTx
      await get.manager.indexTxNow(tx.buff)
      await emptyQueue
      expect(await get.ds.txIsIndexed(tx.txid)).to.eql(true)
    })

    it('queues its post processing', async () => {
      const tx = await get.someRunTx

      const events = []
      get.postIndexQueue.subscribe((event) => {
        events.push(event)
      })

      await get.manager.indexTxNow(tx.buff)

      await emptyQueue
      expect(events).to.have.length(1)
      expect(events[0].txid).to.eql(tx.txid)
    })
  })

  describe('when the tx starts to execute but did not finish', () => {
    let finishExecResolve
    const finishExecPromise = new Promise(resolve => { finishExecResolve = resolve })

    let startExecResolve
    const startExecPromise = new Promise(resolve => { startExecResolve = resolve })

    def('executor', () => ({
      start: () => {},
      stop: () => {},
      execute: async () => {
        return new Promise((resolve) => {
          startExecResolve()
          finishExecPromise.then(() => resolve(new ExecutionResult(true, [], { success: true, cache: {}, missingDeps: [] }, null)))
        })
      },
      executing: new Set()
    }))

    it('adds the tx to executing set and when it finishes it gets removed', async () => {
      const tx = await get.someRunTx
      const finishIndexPromise = get.manager.indexTxNow(tx.buff)

      await startExecPromise
      expect(await get.execSet.check(tx.txid)).to.eql(true)
      finishExecResolve()
      await finishIndexPromise
      expect(await get.execSet.check(tx.txid)).to.eql(false)
    })
  })
})
