/**
 * indexer.test.js
 *
 * Tests for the Indexer
 */

const { describe, it, beforeEach, afterEach } = require('mocha')
const { expect } = require('chai')
const bsv = require('bsv')
const Indexer = require('../src/indexer')
const Run = require('run-sdk')
// const { DEFAULT_TRUSTLIST } = require('../src/config')
const Database = require('../src/database')
const { DbTrustList } = require('../src/trust-list/db-trust-list')
const Executor = require('../src/execution/executor')
const knex = require('knex')
const { KnexDatasource } = require('../src/data-sources/knex-datasource')
const { def, get } = require('bdd-lazy-var/getter')
const { KnexBlobStorage } = require('../src/data-sources/knex-blob-storage')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const fetch = txid => { return { hex: require('./txns.json')[txid] } }
const api = { fetch }
const indexed = (indexer, txid) => new Promise((resolve) => { indexer.onIndex = x => txid === x && resolve() })
// const failed = (indexer, txid) => new Promise((resolve) => { indexer.onFailToIndex = x => txid === x && resolve() })
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

describe('Indexer', () => {
  let knexInstance
  let blobsKnex
  let ds
  let trustList
  let database
  let blobStorage

  def('filter', () => ({
    serialize: JSON.stringify,
    deserialize: JSON.parse
  }))

  beforeEach(async () => {
    knexInstance = knex({
      client: 'sqlite3',
      connection: {
        filename: 'file:memDb1?mode=memory&cache=shared',
        flags: ['OPEN_URI', 'OPEN_SHAREDCACHE']
      },
      migrations: {
        tableName: 'migrations',
        directory: 'db-migrations'
      },
      useNullAsDefault: true
    })

    blobsKnex = knex({
      client: 'sqlite3',
      connection: {
        filename: 'file:memDb2?mode=memory&cache=shared',
        flags: ['OPEN_URI', 'OPEN_SHAREDCACHE']
      },
      migrations: {
        tableName: 'migrations',
        directory: 'blobs-migrations'
      },
      useNullAsDefault: true
    })
    await knexInstance.migrate.latest()
    await blobsKnex.migrate.latest()

    ds = new KnexDatasource(knexInstance, logger, false)
    trustList = new DbTrustList(ds)
    database = new Database(ds, trustList, logger)
    blobStorage = new KnexBlobStorage(blobsKnex, get.filter)

    await database.open()
  })

  afterEach(async () => {
    database.close()
    blobsKnex.destroy()
  })

  // --------------------------------------------------------------------------

  it.skip('add and download dependencies', async () => {
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    await database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it.skip('deletes are not included in unspent', async () => {
    const executor = new Executor('test', 1, database, logger)
    const indexer = new Indexer(database, {}, executor, 1, 1, logger, 0, Infinity, [])
    const rawtx1 = '01000000016f4f66891029280028bce15768b3fdc385533b0bcc77a029add646176207e77f010000006b483045022100a76777ae759178595cb83ce9473699c9056e32faa8e0d07c2517918744fab9e90220369d7a6a2f52b5ddd9bff4ed659ef5a8e676397dac15e9c5dc6dad09e5eab85e412103ac8a61b3fb98161003daaaa63ec1983dc127f4f978a42f2eefd31a074a814345ffffffff030000000000000000fd0301006a0372756e0105004cf87b22696e223a302c22726566223a5b226e61746976653a2f2f4a6967225d2c226f7574223a5b2237373864313934336265613463353166356561313635666630346335613039323435356365386437343335623936336333613130623961343536633463623330225d2c2264656c223a5b5d2c22637265223a5b226d674671626e5254774c3155436d384a654e6e556d6b7a58665a6f3271385764364c225d2c2265786563223a5b7b226f70223a224445504c4f59222c2264617461223a5b22636c617373204120657874656e6473204a6967207b207d222c7b2264657073223a7b224a6967223a7b22246a6967223a307d7d7d5d7d5d7d11010000000000001976a914081c4c589c062b1b1d4e4b25a8b3096868059d7a88acf6def505000000001976a914146caf0030b67f3fae5d53b7c3fa7e1e6fcaaf3b88ac00000000'
    const rawtx2 = '01000000015991661ed379a0d12a68feacdbf7776d82bcffe1761f995cf0412c5ae2d25d28010000006a47304402203776f765d6915431388110a7f4645a61bd8d2f2ab00ade0049f0da95b5455c22022074ca4b6a87891ba852416bf08b64ad3db130a0b780e2a658c451ebacbbcffbf8412103646b0e969bd3825f781f39b737bdfed1e2cd63533301317099e5ac021b4826aaffffffff010000000000000000b1006a0372756e0105004ca67b22696e223a312c22726566223a5b5d2c226f7574223a5b5d2c2264656c223a5b2265386436393434613366383765323936663237326562656437663033623133323962653262313733653732376436623431643632616365343036656434373539225d2c22637265223a5b5d2c2265786563223a5b7b226f70223a2243414c4c222c2264617461223a5b7b22246a6967223a307d2c2264657374726f79222c5b5d5d7d5d7d00000000'
    const txid1 = new bsv.Transaction(rawtx1).hash
    const txid2 = new bsv.Transaction(rawtx2).hash
    await indexer.start()
    const promise = indexed(indexer, txid2)
    await database.addTransaction(txid1, rawtx1)
    await database.addTransaction(txid2, rawtx2)
    await database.trust(txid1)
    await promise
    expect(await indexer.database.getNumUnspent()).to.equal(0)
    await indexer.stop()
  })

  it.skip('mark a transaction as failed when a dependency already failed', async () => {
    const run = new Run({ network: 'mock' })

    class Counter extends Run.Jig {
      init () { this.count = 0 }

      inc () { this.count += 1 }
    }

    run.deploy(Counter)
    await run.sync()
    const instance = new Counter()
    await run.sync()
    instance.inc()
    await run.sync()

    const txid1 = Counter.location.split('_')[0]
    const txid2 = instance.origin.split('_')[0]
    const txid3 = instance.location.split('_')[0]

    const txHex1 = await run.blockchain.fetch(txid1)
    const txHex2 = await run.blockchain.fetch(txid2)
    const txHex3 = await run.blockchain.fetch(txid3)

    const executor = new Executor('test', 1, database, logger)
    const indexer = new Indexer(database, run.blockchain, executor, 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    const promise = indexed(indexer, txid2)
    await database.trust(txid1)
    await database.addTransaction(txid1, txHex1)
    await database.addTransaction(txid2, txHex2)
    await promise
    await database.setTransactionExecutionFailed(txid2)

    await database.addTransaction(txid3, txHex3)

    const metadata = await database.getTxMetadata(txid3)
    expect(metadata.executable).to.eql(0)

    await indexer.stop()
  })

  describe('#indexTransaction', () => {
    def('run', () => new Run({ network: 'mock' }))
    def('txBuf', async () => Buffer.from(
      await get.txHex,
      'hex'
    ))

    def('TxSize', async () => {
      class TxSize extends Run.Berry {
        static async pluck (location, fetch) {
          const hex = fetch(location)
          return new this(hex.length)
        }

        init (size) {
          this.size = size
        }
      }

      get.run.deploy(TxSize)
      await get.run.sync()
      return TxSize
    })

    def('Container', async () => {
      class Container extends Run.Jig {
        init (aThing) {
          this.thing = aThing
        }
      }

      get.run.deploy(Container)
      await get.run.sync()
      return Container
    })

    def('Counter', async () => {
      class Counter extends Run.Jig {

      }

      get.run.deploy(Counter)
      await get.run.sync()
      return Counter
    })

    def('txHex', async () => {
      const Counter = await get.Counter
      const txid = Counter.location.split('_')[0]
      return get.run.blockchain.fetch(txid)
    })

    def('executor', () => {
      return new Executor('test', 1, blobStorage, ds, logger)
    })

    def('indexer', () =>
      new Indexer(database, ds, blobStorage, trustList, get.executor, 'test', logger)
    )

    beforeEach(async () => {
      await blobStorage.pushTx(null, await get.txBuf)

      await get.executor.start()
    })

    afterEach(async () => {
      await get.indexer.stop()
    })

    describe('when the tx is executable and has no dependencies', () => {
      it('pushes the jigs to blob storage', async () => {
        const indexer = get.indexer
        const Counter = await get.Counter

        await indexer.trust(Counter.location.split('_')[0])

        await indexer.indexTransaction(await get.txBuf, null, null)

        const counterState = await blobStorage.pullJigState(Counter.location, () => expect.fail('state should be present'))
        expect(counterState.src).to.eql(Counter.toString().replace('Run.Jig', 'Jig'))
      })

      it('returns executed as true', async () => {
        const Counter = await get.Counter

        await get.indexer.trust(Counter.location.split('_')[0])

        const response = await get.indexer.indexTransaction(await get.txBuf, null, null)

        expect(response.executed).to.eql(true)
      })

      it('craetes the spend')
    })

    describe('when the tx depends of an unknown berry', () => {
      def('randomTx', async () => {
        const randomTxTxid = await get.run.blockchain.fund(bsv.PrivateKey.fromRandom().toAddress(), 10000)
        return {
          txid: randomTxTxid,
          hex: await get.run.blockchain.fetch(randomTxTxid)
        }
      })

      def('aBerry', async () => {
        const TxSize = await get.TxSize
        const randomTx = await get.randomTx
        return await TxSize.load(randomTx.txid)
      })

      it('adds the berry tx in the list of missing deps', async () => {
        const TxSize = await get.TxSize
        const Container = await get.Container
        const aBerry = await get.aBerry
        const randomTx = await get.randomTx

        const container = new Container(aBerry)
        await container.sync()

        const txid = container.location.split('_')[0]
        const txHex = await get.run.blockchain.fetch(txid)
        const txBuf = Buffer.from(txHex, 'hex')

        const result = await get.indexer.indexTransaction(txBuf)
        expect(result.missingDeps).to.include(Container.location.split('_')[0])
        expect(result.missingDeps).to.include(TxSize.location.split('_')[0])
        expect(result.missingDeps).to.include(randomTx.txid)
      })
    })

    describe('when the tx execution fails because there is a missing tx', async () => {
      // def('executor', () => ({
      //   execute: () =>
      // }))
    })

    describe('when the tx is not executable', () => {
      def('tx', () => {
        const bsvTx = new bsv.Transaction()
        const aPrivKey = bsv.PrivateKey.fromRandom()
        const address = bsv.Address.fromPrivateKey(aPrivKey)
        bsvTx.from({
          txid: Buffer.alloc(32).fill(0).toString('hex'),
          vout: 0,
          address: address,
          scriptPubKey: bsv.Script.fromAddress(address),
          amount: 1
        })
        bsvTx.to(address, 9 * 1e7)
        bsvTx.sign([aPrivKey])
        return bsvTx
      })
      def('txBuf', () => {
        return get.tx.toBuffer()
      })

      it('returns false on executed', async () => {
        const response = await get.indexer.indexTransaction(await get.txBuf, null, null)
        expect(response.executed).to.eql(false)
      })

      it('returns empty list for missing deps', async () => {
        const response = await get.indexer.indexTransaction(await get.txBuf, null, null)
        expect(response.missingDeps).to.eql([])
      })

      it('returns empty list for missing trust', async () => {
        const response = await get.indexer.indexTransaction(await get.txBuf, null, null)
        expect(response.missingTrust).to.eql([])
      })

      it('it marks the tx as indexed', async () => {
        await get.indexer.indexTransaction(await get.txBuf, null, null)
        const indexed = await ds.txIsIndexed(get.tx.hash)
        expect(!!indexed).to.eq(true)
      })
    })

    describe('when the tx has a dependency that was not executed before', () => {
      def('txHex', async () => {
        const Counter = await get.Counter
        const instance = new Counter()
        await instance.sync()
        const txid = instance.location.split('_')[0]
        return get.run.blockchain.fetch(txid)
      })

      it('returns false because the tx cannot be immediately executed', async () => {
        const jig = get.run.inventory.jigs[0]

        await get.indexer.trust(jig.location.split('_')[0])

        const response = await get.indexer.indexTransaction(await get.txBuf, null, null)

        expect(response.executed).to.eql(false)
      })

      it('returns information about missing deps', async () => {
        const Counter = await get.Counter
        const jig = get.run.inventory.jigs[0]

        await get.indexer.trust(jig.location.split('_')[0])

        const response = await get.indexer.indexTransaction(await get.txBuf, null, null)
        const depTxid = Counter.location.split('_')[0]
        expect(response.missingDeps).to.eql([depTxid])
      })
    })

    describe('when the tx was not trusted', () => {
      it('does not save anything to the blob storage', async () => {
        const indexer = get.indexer
        const Counter = await get.Counter

        await indexer.indexTransaction(await get.txBuf, null, null)

        const response = await blobStorage.pullJigState(Counter.location, () => null)
        expect(response).to.eql(null)
      })

      it('returns non executed', async () => {
        const indexer = get.indexer
        const response = await indexer.indexTransaction(await get.txBuf, null, null)

        expect(response.executed).to.eql(false)
      })

      it('returns the missing trust', async () => {
        const Counter = await get.Counter
        const indexer = get.indexer
        const response = await indexer.indexTransaction(await get.txBuf, null, null)

        expect(response.missingTrust).to.eql([Counter.location.split('_')[0]])
      })
    })

    describe('when the 2 txs depends on the current txs but one of them has other non executed txs', () => {
      def('SecondClass', async () => {
        class SecondClass extends Run.Jig {}

        get.run.deploy(SecondClass)
        await get.run.sync()
        return SecondClass
      })

      def('txHex2', async () => {
        const Counter = await get.Counter
        const SecondClass = await get.SecondClass
        const { aCounter } = get.run.transaction(() => {
          const aCounter = new Counter()
          const aSecond = new SecondClass()
          return { aCounter, aSecond }
        })
        await get.run.sync()

        return await get.run.blockchain.fetch(aCounter.location.split('_')[0])
      })

      beforeEach(async () => {
        const txHex2 = await get.txHex2
        const Counter = await get.Counter
        const SecondClass = await get.SecondClass

        await get.indexer.trust(Counter.location.split('_')[0])
        await get.indexer.trust(SecondClass.location.split('_')[0])
        await get.indexer.indexTransaction(Buffer.from(txHex2, 'hex'))
      })

      it('does not includes that as an enablement', async () => {
        const result = await get.indexer.indexTransaction(await get.txBuf)
        expect(result.enables).to.eql([])
      })

      it('executes immediately', async () => {
        const result = await get.indexer.indexTransaction(await get.txBuf)
        expect(result.executed).to.eql(true)
      })
    })

    describe('when the tx enables the execution of another tx', () => {
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
})
