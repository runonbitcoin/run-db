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
  def('indexer', () => new Indexer(get.ds, get.blobs, new TrustAllTrustList(), get.executor, 'test', testLogger))
  def('execQueue', () => new MemoryQueue())
  def('trustQueue', () => new MemoryQueue())
  def('postIndexQueue', () => new MemoryQueue())

  def('worker', () => new ExecutionWorker(get.indexer, get.execSet, get.execQueue, get.trustQueue, get.postIndexQueue))

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
    await new Promise(resolve => get.execQueue.onAck(({ txid: someTxid }) => {
      if (someTxid === txid) { resolve() }
    }))

    await get.blobs.pullJigState(Counter.location, () => expect.fail('state should be present'))
  })

  describe('cascade', () => {
    // def('instanceTx', async () => {
    //   const { Counter } = await get.counterTx
    //   const instance = new Counter()
    //   await instance.sync()
    //
    //   const txid = txidFromLocation(instance.location)
    //   const txHex = await get.run.blockchain.fetch(txid)
    //   return {
    //     tx: { txid, buff: Buffer.from(txHex, 'hex') },
    //     instance
    //   }
    // })

    it('starts other executions when set to true', async () => {
      const { tx: { txid } } = await get.counterTx

      await get.execQueue.publish({ txid: txid, cascade: true })
      await new Promise(resolve => get.postIndexQueue.subscribe(({ txid: postIndexTxid }) => {
        expect(postIndexTxid).to.eql(txid)
        resolve()
      }))
    })

    it('does not start other executions when set to false', async () => {
      const { tx: { txid } } = await get.counterTx

      await get.execQueue.publish({ txid: txid, cascade: false })
      get.postIndexQueue.subscribe(() => {
        expect.fail('should not publish')
      })

      await get.postIndexQueue.current
    })
  })
})
