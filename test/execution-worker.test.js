const { ExecutionWorker, Indexer, TrustAllTrustList } = require('../src')
const { buildBlobs, buildDs, buildExecutor, testLogger } = require('./test-env')
const { MemoryQueue } = require('../src/queues/memory-queu')
const Run = require('run-sdk')
const { def, get } = require('bdd-lazy-var')
const { buildCounter } = require('./test-jigs/counter')
const { txidFromLocation } = require('../src/util/txid-from-location')
const { expect } = require('chai')
const { ExecutingSet } = require('../src/executing-set')

describe('ExecutionWorker', () => {
  def('run', () => new Run({ network: 'mock' }))

  def('ds', () => buildDs())
  def('blobs', () => buildBlobs())
  def('numWorkers', () => 1)
  def('executor', () => buildExecutor('test', get.blobs, get.ds, { numWorkers: get.numWorkers }))
  def('execSet', () => new ExecutingSet(get.ds))
  def('indexer', () => new Indexer(get.ds, get.blobs, new TrustAllTrustList(), get.executor, 'test', get.execSet, testLogger))
  def('execQueue', () => new MemoryQueue())
  def('trustQueue', () => new MemoryQueue())

  def('worker', () => new ExecutionWorker(get.indexer, get.execSet, get.execQueue, get.trustQueue))

  beforeEach(async () => {
    await get.ds.setUp()
    await get.blobs.setUp()
    await get.executor.start()
    await get.indexer.start()
    await get.execQueue.setUp()
    await get.trustQueue.setUp()

    await get.worker.setUp()
  })

  def('counterTx', async () => {
    const Counter = buildCounter()
    get.run.deploy(Counter)
    await get.run.sync()

    const txid = txidFromLocation(Counter.location)
    const txHex = await get.run.blockchain.fetch(txid)
    return {
      tx: { txid, buff: Buffer.from(txHex, 'hex') },
      Counter
    }
  })

  afterEach(async () => {
    await get.worker.tearDown()
    await get.execQueue.tearDown()
    await get.indexer.stop()
    await get.executor.stop()
    await get.blobs.tearDown()
    await get.ds.tearDown()
  })

  it('indexes a tx', async () => {
    const { tx: { txid, buff }, Counter } = await get.counterTx

    await get.blobs.pushTx(txid, buff)

    await get.execQueue.publish({ txid })
    await new Promise(resolve => get.execQueue.onEmpty(resolve))

    await get.blobs.pullJigState(Counter.location, () => expect.fail('state should be present'))
  })

  describe('cascade', () => {
    def('instanceTx', async () => {
      const { Counter } = await get.counterTx
      const instance = new Counter()
      await instance.sync()

      const txid = txidFromLocation(instance.location)
      const txHex = await get.run.blockchain.fetch(txid)
      return {
        tx: { txid, buff: Buffer.from(txHex, 'hex') },
        instance
      }
    })

    it('starts other executions when set to true', async () => {
      const { tx: { txid: txid1, buff: buff1 }, Counter } = await get.counterTx
      const { tx: { txid: txid2, buff: buff2 }, instance } = await get.instanceTx

      await get.blobs.pushTx(txid1, buff1)
      await get.blobs.pushTx(txid2, buff2)

      let count = 0
      await get.execQueue.publish({ txid: txid2, cascade: true })
      await new Promise(resolve => get.execQueue.onAck(() => {
        count++
        if (count >= 3) {
          resolve()
        }
      }))

      await get.execQueue.current
      expect(get.execQueue.pending).to.have.length(0)
      await get.blobs.pullJigState(Counter.location, () => expect.fail('state should be present'))
      await get.blobs.pullJigState(instance.location, () => expect.fail('state should be present'))
    })

    it('does not starts other dependency executions when set to false', async () => {
      const { tx: { txid: txid1, buff: buff1 }, Counter } = await get.counterTx
      const { tx: { txid: txid2, buff: buff2 }, instance } = await get.instanceTx

      await get.blobs.pushTx(txid1, buff1)
      await get.blobs.pushTx(txid2, buff2)

      // let count = 0
      await get.execQueue.publish({ txid: txid2, cascade: false })

      await get.execQueue.current
      expect(get.execQueue.pending).to.have.length(0)
      const res1 = await get.blobs.pullJigState(Counter.location, () => null)
      const res2 = await get.blobs.pullJigState(instance.location, () => null)
      expect(res1).to.eql(null)
      expect(res2).to.eql(null)
    })

    it('does starts other dependency executions when not set', async () => {
      const { tx: { txid: txid1, buff: buff1 }, Counter } = await get.counterTx
      const { tx: { txid: txid2, buff: buff2 }, instance } = await get.instanceTx

      await get.blobs.pushTx(txid1, buff1)
      await get.blobs.pushTx(txid2, buff2)

      let count = 0
      await get.execQueue.publish({ txid: txid2 }) // cascade not set
      await new Promise(resolve => get.execQueue.onAck(() => {
        count++
        if (count >= 3) {
          resolve()
        }
      }))

      await get.execQueue.current
      expect(get.execQueue.pending).to.have.length(0)
      await get.blobs.pullJigState(Counter.location, () => expect.fail('state should be present'))
      await get.blobs.pullJigState(instance.location, () => expect.fail('state should be present'))
    })

    it('starts enablements when set to true', async () => {
      const { tx: { txid: txid1, buff: buff1 }, Counter } = await get.counterTx
      const { tx: { txid: txid2, buff: buff2 }, instance } = await get.instanceTx

      await get.blobs.pushTx(txid1, buff1)
      await get.blobs.pushTx(txid2, buff2)

      // let count = 0
      await get.execQueue.publish({ txid: txid2, cascade: false }) // cascade not set
      await get.execQueue.current
      await get.execQueue.publish({ txid: txid1, cascade: true })
      await new Promise(resolve => get.execQueue.onAck(({ txid }) => {
        if (txid === txid2) { resolve() }
      }))

      await get.blobs.pullJigState(Counter.location, () => expect.fail('state should be present'))
      await get.blobs.pullJigState(instance.location, () => expect.fail('state should be present'))
    })
  })
})
