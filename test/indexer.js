/**
 * indexer.js
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

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const fetch = txid => { return { hex: require('./txns.json')[txid] } }
const api = { fetch }
const indexed = (indexer, txid) => new Promise((resolve, reject) => { indexer.onIndex = x => txid === x && resolve() })
const failed = (indexer, txid) => new Promise((resolve, reject) => { indexer.onFailToIndex = x => txid === x && resolve() })
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
const database = new Database(':memory:', logger, false)

beforeEach(() => database.open())
afterEach(() => database.close())

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

describe('Indexer', () => {
  it('add and index', async () => {
    const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    database.addTransaction('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64')
    database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    database.trust('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64')
    database.trust('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    const txid = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102'
    expect(database.getTransactionHex(txid)).to.equal(fetch(txid).hex)
    expect(database.getTransactionHeight(txid)).to.equal(null)
    expect(database.getTransactionTime(txid)).to.be.greaterThan(new Date() / 1000 - 3)
    expect(database.getTransactionTime(txid)).to.be.lessThan(new Date() / 1000 + 3)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('index jig sent to pubkey', async () => {
    new Run({ network: 'mock' }) // eslint-disable-line
    class A extends Jig { init (owner) { this.owner = owner } }
    const tx = new Run.Transaction()
    const pubkey = new bsv.PrivateKey('testnet').toPublicKey().toString()
    tx.update(() => new A(pubkey))
    const rawtx = await tx.export()
    const api = { fetch: txid => { return { hex: rawtx } } }
    const indexer = new Indexer(database, api, 'test', 1, 1, logger, 0, Infinity, [])
    const txid = new bsv.Transaction(rawtx).hash
    await indexer.start()
    database.addTransaction(txid)
    database.trust(txid)
    await indexed(indexer, txid)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('add in reverse and index', async () => {
    const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    database.addTransaction('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64')
    database.trust('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64')
    database.trust('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('fail to index', async () => {
    const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    database.trust('b17a9af70ab0f46809f908b2e900e395ba40996000bf4f00e3b27a1e93280cf1')
    database.trust('a5291157ab7a2d80d834bbe82c380ce3976f53990d20c62c477ca3a2ac93a7e9')
    database.addTransaction('b17a9af70ab0f46809f908b2e900e395ba40996000bf4f00e3b27a1e93280cf1')
    database.addTransaction('a5291157ab7a2d80d834bbe82c380ce3976f53990d20c62c477ca3a2ac93a7e9')
    await failed(indexer, 'a5291157ab7a2d80d834bbe82c380ce3976f53990d20c62c477ca3a2ac93a7e9')
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('discovered berry transaction', async () => {
    const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    database.addTransaction('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d') // Class with berry image
    database.addTransaction('24cde3638a444c8ad397536127833878ffdfe1b04d5595489bd294e50d77105a') // B (old)
    database.addTransaction('312985bd960ae4c59856b3089b04017ede66506ea181333eec7c9bb88b11c490') // txo, Tx
    database.addTransaction('727e7b423b7ee40c0b5be87fba7fa5673ea2d20a74259040a7295d9c32a90011') // Hex
    database.trust('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
    database.trust('24cde3638a444c8ad397536127833878ffdfe1b04d5595489bd294e50d77105a')
    database.trust('312985bd960ae4c59856b3089b04017ede66506ea181333eec7c9bb88b11c490')
    database.trust('727e7b423b7ee40c0b5be87fba7fa5673ea2d20a74259040a7295d9c32a90011')
    // Don't index the berry data, because it will be fetched automatically
    // database.addTransaction('2f3492ef5401d887a93ca09820dff952f355431cea306841a70d163e32b2acad') // Berry data
    await indexed(indexer, 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('add and download dependencies', async () => {
    const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await new Promise((resolve, reject) => setTimeout(resolve, 1000))
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('remove discovered dep', async () => {
    const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
    await indexer.start()
    database.addTransaction('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d') // Class with berry image
    database.trust('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
    await indexed(indexer, 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
    expect(database.getTransactionHex('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')).not.to.equal(undefined)
    database.deleteTransaction('2f3492ef5401d887a93ca09820dff952f355431cea306841a70d163e32b2acad') // Berry data
    expect(database.getTransactionHex('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')).to.equal(undefined)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('get spent', async function () {
    this.timeout(40000)
    const indexer = new Indexer(database, api, 'main', 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
    await indexer.start()
    database.addTransaction('11f27cdad53128a4eb14c8328515dfab56b16ea5a71dd26abe9e9d7488f3ab83')
    await indexed(indexer, '11f27cdad53128a4eb14c8328515dfab56b16ea5a71dd26abe9e9d7488f3ab83')
    expect(database.getSpend('7fa1b0eb8408047e138aadf72ee0980e42afab2208181429b050ad495a384d39_o1'))
      .to.equal('11f27cdad53128a4eb14c8328515dfab56b16ea5a71dd26abe9e9d7488f3ab83')
    expect(database.getSpend('11f27cdad53128a4eb14c8328515dfab56b16ea5a71dd26abe9e9d7488f3ab83_o1'))
      .to.equal(null)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('mark failed execute as melts', async () => {
    const indexer = new Indexer(database, {}, 'test', 1, 1, logger, 0, Infinity, [])
    const rawtx1 = '0100000001a11d53c34263d1ea9dec40d3cc5beb7eb461a601d898a8337dea215cd90a9e4a010000006a47304402202f294c5ceca857cfc03e38b1a49a79d6c133e9e6b18047f0301f9f74bb2abdab022027aa6662cd24428106b9f8f2e38d2e5b8f0b7c30929eef6dbc1d013c43b0493f41210211f2cc632921525ec8650cb65c2ed520e400a2644010c1e794203d5823f604c0ffffffff030000000000000000fd0301006a0372756e0105004cf87b22696e223a302c22726566223a5b226e61746976653a2f2f4a6967225d2c226f7574223a5b2238396336653439636532653831373962653138383563396230653032343863363935666130373634343939656665626362363936623238323732366239666165225d2c2264656c223a5b5d2c22637265223a5b226d737138444642455777546166675a6173474c4a386f3338517a456367346267364a225d2c2265786563223a5b7b226f70223a224445504c4f59222c2264617461223a5b22636c617373204120657874656e6473204a6967207b207d222c7b2264657073223a7b224a6967223a7b22246a6967223a307d7d7d5d7d5d7d11010000000000001976a9148711466c1f8b5977cb788485fcb6cc1fb9d0407788acf6def505000000001976a9142208fb2364d1551e2dd26549d7c22eab613a207188ac00000000'
    const rawtx2 = '0100000002cb8c61b7d73cf14ed2526f2adcb0ef941563c69fb794a87eb39a94423886d273010000006a4730440220306a24e0464c90889d6fd1580db4420fe9ee1bd8f167ec793d40d2296ff0d8ea02202224f4f13e4c07354478983b2dc88170342a4f1ac3e6cacad8616a92348fc768412103a6fa27cfcda39be6ee9dc5dbd43a44c2c749ca136f7d41cd81468f72cc0fda59ffffffffcb8c61b7d73cf14ed2526f2adcb0ef941563c69fb794a87eb39a94423886d273020000006b483045022100c2b7a660b22dd2c3ac22d47ba16fa3f7df852f5a6cfdec5ce14c734517a0b1900220592da53a61ec1387aa96050c370b7c5ba162ee35e8d30b55d9999f1c2ba06ade41210211f2cc632921525ec8650cb65c2ed520e400a2644010c1e794203d5823f604c0ffffffff030000000000000000ae006a0372756e0105004ca37b22696e223a312c22726566223a5b5d2c226f7574223a5b2264633031326334616436346533626136373632383762323239623865306662303934326448626535303435393036363830616637633937663134666239663433225d2c2264656c223a5b5d2c22637265223a5b5d2c2265786563223a5b7b226f70223a2243414c4c222c2264617461223a5b7b22246a6967223a307d2c2261757468222c5b5d5d7d5d7d11010000000000001976a9148711466c1f8b5977cb788485fcb6cc1fb9d0407788acdeddf505000000001976a9142208fb2364d1551e2dd26549d7c22eab613a207188ac00000000'
    const txid1 = new bsv.Transaction(rawtx1).hash
    const txid2 = new bsv.Transaction(rawtx2).hash
    await indexer.start()
    database.addTransaction(txid1, rawtx1)
    database.trust(txid1)
    await indexed(indexer, txid1)
    database.addTransaction(txid2, rawtx2)
    await failed(indexer, txid2)
    expect(database.getSpend(txid1 + '_o1')).to.equal(txid2)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('deletes are not included in unspent', async () => {
    const indexer = new Indexer(database, {}, 'test', 1, 1, logger, 0, Infinity, [])
    const rawtx1 = '01000000016f4f66891029280028bce15768b3fdc385533b0bcc77a029add646176207e77f010000006b483045022100a76777ae759178595cb83ce9473699c9056e32faa8e0d07c2517918744fab9e90220369d7a6a2f52b5ddd9bff4ed659ef5a8e676397dac15e9c5dc6dad09e5eab85e412103ac8a61b3fb98161003daaaa63ec1983dc127f4f978a42f2eefd31a074a814345ffffffff030000000000000000fd0301006a0372756e0105004cf87b22696e223a302c22726566223a5b226e61746976653a2f2f4a6967225d2c226f7574223a5b2237373864313934336265613463353166356561313635666630346335613039323435356365386437343335623936336333613130623961343536633463623330225d2c2264656c223a5b5d2c22637265223a5b226d674671626e5254774c3155436d384a654e6e556d6b7a58665a6f3271385764364c225d2c2265786563223a5b7b226f70223a224445504c4f59222c2264617461223a5b22636c617373204120657874656e6473204a6967207b207d222c7b2264657073223a7b224a6967223a7b22246a6967223a307d7d7d5d7d5d7d11010000000000001976a914081c4c589c062b1b1d4e4b25a8b3096868059d7a88acf6def505000000001976a914146caf0030b67f3fae5d53b7c3fa7e1e6fcaaf3b88ac00000000'
    const rawtx2 = '01000000015991661ed379a0d12a68feacdbf7776d82bcffe1761f995cf0412c5ae2d25d28010000006a47304402203776f765d6915431388110a7f4645a61bd8d2f2ab00ade0049f0da95b5455c22022074ca4b6a87891ba852416bf08b64ad3db130a0b780e2a658c451ebacbbcffbf8412103646b0e969bd3825f781f39b737bdfed1e2cd63533301317099e5ac021b4826aaffffffff010000000000000000b1006a0372756e0105004ca67b22696e223a312c22726566223a5b5d2c226f7574223a5b5d2c2264656c223a5b2265386436393434613366383765323936663237326562656437663033623133323962653262313733653732376436623431643632616365343036656434373539225d2c22637265223a5b5d2c2265786563223a5b7b226f70223a2243414c4c222c2264617461223a5b7b22246a6967223a307d2c2264657374726f79222c5b5d5d7d5d7d00000000'
    const txid1 = new bsv.Transaction(rawtx1).hash
    const txid2 = new bsv.Transaction(rawtx2).hash
    await indexer.start()
    database.addTransaction(txid1, rawtx1)
    database.addTransaction(txid2, rawtx2)
    database.trust(txid1)
    await indexed(indexer, txid2)
    expect(indexer.database.getNumUnspent()).to.equal(0)
    await indexer.stop()
  })
})

// ------------------------------------------------------------------------------------------------
