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
const { Jig } = Run
const { DEFAULT_TRUSTLIST } = require('../src/config')
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
const failed = (indexer, txid) => new Promise((resolve) => { indexer.onFailToIndex = x => txid === x && resolve() })
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

  it('add and index', async () => {
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    const promise = indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await database.addTransaction('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64')
    await database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await database.trust('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64')
    await database.trust('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await promise
    const txid = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102'
    expect(await database.getTransactionHex(txid)).to.equal(fetch(txid).hex)
    expect(await database.getTransactionHeight(txid)).to.equal(null)
    expect(await database.getTransactionTime(txid)).to.be.greaterThan(new Date() / 1000 - 3)
    expect(await database.getTransactionTime(txid)).to.be.lessThan(new Date() / 1000 + 3)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('index jig sent to pubkey', async () => {
    new Run({ network: 'mock' }) // eslint-disable-line
    class A extends Jig {init (owner) { this.owner = owner }}

    const tx = new Run.Transaction()
    const pubkey = new bsv.PrivateKey('testnet').toPublicKey().toString()
    tx.update(() => new A(pubkey))
    const rawtx = await tx.export()
    const api = { fetch: _txid => { return { hex: rawtx } } }
    const executor = new Executor('test', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, [])
    const txid = new bsv.Transaction(rawtx).hash
    await indexer.start()
    database.addTransaction(txid)
    database.trust(txid)
    await indexed(indexer, txid)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('add in reverse and index', async () => {
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    const promise = indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await database.addTransaction('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64')
    await database.trust('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64')
    await database.trust('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await promise
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('fail to index', async () => {
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    const promise = failed(indexer, 'a5291157ab7a2d80d834bbe82c380ce3976f53990d20c62c477ca3a2ac93a7e9')
    await database.trust('b17a9af70ab0f46809f908b2e900e395ba40996000bf4f00e3b27a1e93280cf1')
    await database.trust('a5291157ab7a2d80d834bbe82c380ce3976f53990d20c62c477ca3a2ac93a7e9')
    await database.addTransaction('b17a9af70ab0f46809f908b2e900e395ba40996000bf4f00e3b27a1e93280cf1')
    await database.addTransaction('a5291157ab7a2d80d834bbe82c380ce3976f53990d20c62c477ca3a2ac93a7e9')
    await promise
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('discovered berry transaction', async () => {
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    const promise = indexed(indexer, 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
    await database.addTransaction('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d') // Class with berry image
    await database.addTransaction('24cde3638a444c8ad397536127833878ffdfe1b04d5595489bd294e50d77105a') // B (old)
    await database.addTransaction('312985bd960ae4c59856b3089b04017ede66506ea181333eec7c9bb88b11c490') // txo, Tx
    await database.addTransaction('727e7b423b7ee40c0b5be87fba7fa5673ea2d20a74259040a7295d9c32a90011') // Hex
    await database.trust('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
    await database.trust('24cde3638a444c8ad397536127833878ffdfe1b04d5595489bd294e50d77105a')
    await database.trust('312985bd960ae4c59856b3089b04017ede66506ea181333eec7c9bb88b11c490')
    await database.trust('727e7b423b7ee40c0b5be87fba7fa5673ea2d20a74259040a7295d9c32a90011')
    // Don't index the berry data, because it will be fetched automatically
    // database.addTransaction('2f3492ef5401d887a93ca09820dff952f355431cea306841a70d163e32b2acad') // Berry data
    await promise
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('add and download dependencies', async () => {
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    await database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('remove discovered dep', async () => {
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
    await indexer.start()
    const promise = indexed(indexer, 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
    await database.trust('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
    await database.addTransaction('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d') // Class with berry image
    await promise
    expect(await database.getTransactionHex('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')).not.to.equal(undefined)
    await database.deleteTransaction('2f3492ef5401d887a93ca09820dff952f355431cea306841a70d163e32b2acad') // Berry data
    expect(await database.getTransactionHex('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')).to.equal(undefined)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('get spent', async function () {
    this.timeout(40000)
    const executor = new Executor('main', 1, database, logger)
    const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
    await indexer.start()
    const promise = indexed(indexer, '11f27cdad53128a4eb14c8328515dfab56b16ea5a71dd26abe9e9d7488f3ab83')
    await database.addTransaction('11f27cdad53128a4eb14c8328515dfab56b16ea5a71dd26abe9e9d7488f3ab83')
    await promise
    expect(await database.getSpend('7fa1b0eb8408047e138aadf72ee0980e42afab2208181429b050ad495a384d39_o1'))
      .to.equal('11f27cdad53128a4eb14c8328515dfab56b16ea5a71dd26abe9e9d7488f3ab83')
    expect(await database.getSpend('11f27cdad53128a4eb14c8328515dfab56b16ea5a71dd26abe9e9d7488f3ab83_o1'))
      .to.equal(null)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('mark failed execute as melts', async () => {
    const executor = new Executor('test', 1, database, logger)
    const indexer = new Indexer(database, {}, executor, 1, 1, logger, 0, Infinity, [])
    const rawtx1 = '0100000001a11d53c34263d1ea9dec40d3cc5beb7eb461a601d898a8337dea215cd90a9e4a010000006a47304402202f294c5ceca857cfc03e38b1a49a79d6c133e9e6b18047f0301f9f74bb2abdab022027aa6662cd24428106b9f8f2e38d2e5b8f0b7c30929eef6dbc1d013c43b0493f41210211f2cc632921525ec8650cb65c2ed520e400a2644010c1e794203d5823f604c0ffffffff030000000000000000fd0301006a0372756e0105004cf87b22696e223a302c22726566223a5b226e61746976653a2f2f4a6967225d2c226f7574223a5b2238396336653439636532653831373962653138383563396230653032343863363935666130373634343939656665626362363936623238323732366239666165225d2c2264656c223a5b5d2c22637265223a5b226d737138444642455777546166675a6173474c4a386f3338517a456367346267364a225d2c2265786563223a5b7b226f70223a224445504c4f59222c2264617461223a5b22636c617373204120657874656e6473204a6967207b207d222c7b2264657073223a7b224a6967223a7b22246a6967223a307d7d7d5d7d5d7d11010000000000001976a9148711466c1f8b5977cb788485fcb6cc1fb9d0407788acf6def505000000001976a9142208fb2364d1551e2dd26549d7c22eab613a207188ac00000000'
    const rawtx2 = '0100000002cb8c61b7d73cf14ed2526f2adcb0ef941563c69fb794a87eb39a94423886d273010000006a4730440220306a24e0464c90889d6fd1580db4420fe9ee1bd8f167ec793d40d2296ff0d8ea02202224f4f13e4c07354478983b2dc88170342a4f1ac3e6cacad8616a92348fc768412103a6fa27cfcda39be6ee9dc5dbd43a44c2c749ca136f7d41cd81468f72cc0fda59ffffffffcb8c61b7d73cf14ed2526f2adcb0ef941563c69fb794a87eb39a94423886d273020000006b483045022100c2b7a660b22dd2c3ac22d47ba16fa3f7df852f5a6cfdec5ce14c734517a0b1900220592da53a61ec1387aa96050c370b7c5ba162ee35e8d30b55d9999f1c2ba06ade41210211f2cc632921525ec8650cb65c2ed520e400a2644010c1e794203d5823f604c0ffffffff030000000000000000ae006a0372756e0105004ca37b22696e223a312c22726566223a5b5d2c226f7574223a5b2264633031326334616436346533626136373632383762323239623865306662303934326448626535303435393036363830616637633937663134666239663433225d2c2264656c223a5b5d2c22637265223a5b5d2c2265786563223a5b7b226f70223a2243414c4c222c2264617461223a5b7b22246a6967223a307d2c2261757468222c5b5d5d7d5d7d11010000000000001976a9148711466c1f8b5977cb788485fcb6cc1fb9d0407788acdeddf505000000001976a9142208fb2364d1551e2dd26549d7c22eab613a207188ac00000000'
    const txid1 = new bsv.Transaction(rawtx1).hash
    const txid2 = new bsv.Transaction(rawtx2).hash
    await indexer.start()
    const successPromise = indexed(indexer, txid1)
    const failurePromise = failed(indexer, txid2)
    await database.addTransaction(txid1, rawtx1)
    await database.trust(txid1)
    await successPromise
    await database.addTransaction(txid2, rawtx2)
    await failurePromise
    await indexer.stop()
    expect(await database.getSpend(txid1 + '_o1')).to.equal(txid2)
  })

  // --------------------------------------------------------------------------

  it('deletes are not included in unspent', async () => {
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

  it('mark a transaction as failed when a dependency already failed', async () => {
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
