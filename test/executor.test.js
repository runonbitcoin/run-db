const { expect } = require('chai')
const { get, def } = require('bdd-lazy-var/getter')
const { KnexBlobStorage } = require('../src/data-sources/knex-blob-storage')
const knex = require('knex')
const Run = require('run-sdk')
const { buildCounter } = require('./test-jigs/counter')
const { Executor } = require('../src/execution/executor')

describe('Executor', () => {
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

  def('runCache', () => new Map())

  def('run', () => new Run({ network: 'mock', cache: get.runCache }))

  def('tx1', async () => {
    const Counter = buildCounter()

    const { instance } = get.run.transaction(() => {
      const Deployed = get.run.deploy(Counter)
      const instance = new Deployed()
      // instance.inc()
      return { Deployed, instance }
    })
    await get.run.sync()

    const txid = instance.location.split('_')[0]
    const hex = await get.run.blockchain.fetch(txid)
    return { txid, buff: Buffer.from(hex, 'hex') }
  })

  def('tx2', async () => {
    await get.tx1
    const jig = get.run.inventory.jigs[0]
    jig.inc()
    await jig.sync()

    const txid = jig.location.split('_')[0]
    const hex = await get.run.blockchain.fetch(txid)
    return { txid, buff: Buffer.from(hex, 'hex') }
  })

  def('network', () => 'test')
  def('opts', () => { return {} })

  def('executor', () => new Executor(get.network, 1, get.blobs, get.ds, console, get.opts))

  beforeEach(async () => {
    await get.blobs.setUp()
    await get.executor.start()
  })

  afterEach(async () => {
    await get.executor.stop()
    await get.blobs.tearDown()
  })

  it('can execute a tx with dependencies', async () => {
    const tx1 = await get.tx1
    const tx2 = await get.tx2
    await get.blobs.pushTx(tx2.txid, tx2.buff)
    await get.blobs.pushJigState(`${tx1.txid}_o1`, get.runCache.get(`jig://${tx1.txid}_o1`))
    await get.blobs.pushJigState(`${tx1.txid}_o2`, get.runCache.get(`jig://${tx1.txid}_o2`))
    const response = await get.executor.execute(tx2.txid, ['*'])
    expect(response.success).to.eql(true)
  })

  describe('when the cache provider is knex', () => {
    def('opts', () => ({
      cacheProviderPath: require.resolve('../src/worker/knex-cache-provider'),
      workerEnv: {
        FILTER_PATH: require.resolve('../src/data-sources/json-filter'),
        KNEX_CONFIG: JSON.stringify({
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
      }
    }))
    it('works', async () => {
      const tx1 = await get.tx1
      const tx2 = await get.tx2
      await get.blobs.pushTx(tx2.txid, tx2.buff)
      await get.blobs.pushJigState(`${tx1.txid}_o1`, get.runCache.get(`jig://${tx1.txid}_o1`))
      await get.blobs.pushJigState(`${tx1.txid}_o2`, get.runCache.get(`jig://${tx1.txid}_o2`))
      const response = await get.executor.execute(tx2.txid, ['*'])
      expect(response.success).to.eql(true)
    })
  })
})
