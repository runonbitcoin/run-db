const { expect } = require('chai')
const { get, def } = require('bdd-lazy-var/getter')
const knex = require('knex')
const { KnexDatasource } = require('../src/data-sources/knex-datasource')
const { DbTrustList } = require('../src/trust-list/db-trust-list')
const { KnexBlobStorage } = require('../src/data-sources/knex-blob-storage')
const { Executor } = require('../src/execution/executor')
const Indexer = require('../src/indexer')
const { TestBlockchainApi } = require('../src/blockchain-api/test-blockchain-api')
const Run = require('run-sdk')
const { beforeEach, afterEach } = require('mocha')
const { ExecutionManager } = require('../src/execution-manager')
const { MemoryQueue } = require('../src/queues/memory-queu')
const { buildTxSize } = require('./test-jigs/tx-size')
const { buildContainer } = require('./test-jigs/container')
const bsv = require('bsv')
const { ExecutionWorker } = require('../src/execution-worker')

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

describe('ExecutionManager', () => {
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
    return new DbTrustList(get.ds)
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

  def('run', () => new Run({ network: 'mock', cache: new Map() }))

  def('execQueue', () => new MemoryQueue())
  def('trustQueue', () => new MemoryQueue())
  def('manager', () => new ExecutionManager(get.blobs, get.execQueue, get.trustQueue))

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
    return new ExecutionWorker(get.indexer, get.execQueue, get.trustQueue)
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

    it('queues its enablements', async () => {
      const tx = await get.someRunTx
      const childTx = await get.childRunTx

      const events = []
      get.execQueue.subscribe((event) => {
        events.push(event)
      })

      await get.manager.indexTxNow(tx.buff)

      await emptyQueue
      expect(events).to.have.length(2)
      expect(events[0].txid).to.eql(tx.txid)
      expect(events[1].txid).to.eql(childTx.txid)
    })
  })

  describe('when the tx depends on an unknown transaction', () => {
    def('deployTx', async () => {
      const TxSize = buildTxSize()
      const Container = buildContainer()
      get.run.transaction(() => {
        get.run.deploy(TxSize)
        get.run.deploy(Container)
      })
      await get.run.sync()
      const txid = TxSize.location.split('_')[0]
      const hex = await get.run.blockchain.fetch(txid)
      return { txid, hex, buff: Buffer.from(hex, 'hex') }
    })

    def('classes', async () => {
      await get.deployTx
      const TxSize = get.run.inventory.code.find(code => code.name === 'TxSize')
      const Container = get.run.inventory.code.find(code => code.name === 'Container')
      return { TxSize, Container }
    })

    def('randomTx', async () => {
      const randomTxTxid = await get.run.blockchain.fund(bsv.PrivateKey.fromRandom().toAddress(), 10000)
      return {
        txid: randomTxTxid,
        hex: await get.run.blockchain.fetch(randomTxTxid)
      }
    })

    def('instanceTx', async () => {
      const { TxSize, Container } = await get.classes
      const { txid: randomTxTxid } = await get.randomTx
      const berry = await TxSize.load(randomTxTxid)
      const jig = new Container(berry)
      await jig.sync()

      const txid = jig.location.split('_')[0]
      const hex = await get.run.blockchain.fetch(txid)
      return { txid, hex, buff: Buffer.from(hex, 'hex') }
    })

    beforeEach(async () => {
      const { txid: deployTxTxid, buff: rawDeployTx } = await get.deployTx
      await get.indexer.trust(deployTxTxid)

      await get.indexer.trust(deployTxTxid)
      await get.manager.indexTxNow(rawDeployTx)
    })

    it('queues the unknown transaction', async () => {
      const { buff } = await get.instanceTx
      const { txid: randomTxTxid } = await get.randomTx

      const prom = new Promise(resolve => {
        get.execQueue.subscribe((event) => {
          if (event.txid === randomTxTxid) { resolve(event) }
        })
      })

      await get.manager.indexTxNow(buff)

      const event = await prom
      expect(event.txid).to.eql(randomTxTxid)
    })
  })

  describe('when the tx was not executed because of missing dep', async () => {
    it('does not queue its found deps', async () => {
      const childTx = await get.childRunTx
      const events = []
      get.execQueue.subscribe((event) => {
        events.push(event)
      })

      await get.manager.indexTxNow(childTx.buff)
      expect(events).to.have.length(1)
      expect(events[0].txid).to.eql(childTx.txid)
    })
  })
})
