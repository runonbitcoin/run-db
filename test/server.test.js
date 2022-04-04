/**
 * server.test.js
 *
 * Tests for src/server.test.js
 */

const { describe, it, beforeEach, afterEach } = require('mocha')
require('chai').use(require('chai-as-promised'))
const request = require('supertest')
const { expect } = require('chai')
const axios = require('axios')
const Indexer = require('../src/indexer')
const { DEFAULT_TRUSTLIST } = require('../src/config')
const { buildMainServer } = require('../src/http/build-main-server')
const { Executor } = require('../src/execution/executor')
const knex = require('knex')
const { KnexDatasource } = require('../src/data-sources/knex-datasource')
const { def, get } = require('bdd-lazy-var/getter')
const { KnexBlobStorage } = require('../src/data-sources/knex-blob-storage')
const { DbTrustList } = require('../src/trust-list/db-trust-list')
const Run = require('run-sdk')
const { buildCounter } = require('./test-jigs/counter')
const { buildTxSize } = require('./test-jigs/tx-size')
const { buildContainer } = require('./test-jigs/container')
const bsv = require('bsv')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const fetch = async txid => {
  return { hex: require('./txns.json')[txid] }
}
const api = { fetch }
const downloaded = (indexer, txid) => new Promise((resolve) => { indexer.onDownload = x => txid === x && resolve() })
const indexed = (indexer, txid) => new Promise((resolve) => { indexer.onIndex = x => txid === x && resolve() })
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

// ------------------------------------------------------------------------------------------------
// Server
// ------------------------------------------------------------------------------------------------

describe('Server', () => {
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
  def('executor', () => new Executor(get.network, 1, get.blobs, get.ds, console, {}))
  def('trustList', () => new DbTrustList())
  def('indexer', () => new Indexer(null, get.ds, get.blobs, get.trustList, get.executor, get.network, console))

  def('run', new Run({ network: 'mock', cache: new Map() }))

  def('someRunTx', async () => {
    const Counter = buildCounter()
    get.run.deploy(Counter)
    await get.run.sync()
    const txid = Counter.location.split('_')[0]
    return {
      txid,
      buff: Buffer.from(await get.run.blockchain.fetch(txid), 'hex')
    }
  })

  def('server', () => {
    const server = buildMainServer(get.ds, get.blobs, get.indexer, console)
    server.prepare()
    return server
  })

  beforeEach(async () => {
    await get.ds.setUp()
    await get.blobs.setUp()
    await get.executor.start()
    await get.indexer.start()
  })

  afterEach(async () => {
    await get.ds.tearDown()
    await get.blobs.tearDown()
    await get.executor.stop()
    await get.indexer.stop()
  })

  // --------------------------------------------------------------------------
  // post tx
  // --------------------------------------------------------------------------

  describe('post tx', () => {
    def('tx', () => get.someRunTx)

    beforeEach(async () => {
      const { txid } = await get.tx
      await get.indexer.trust(txid)
    })

    it('returns the txid', async () => {
      const server = get.server
      const tx = await get.tx
      const response = await request(server.app)
        .post('/tx')
        .set('content-type', 'application/octet-stream')
        .send(tx.buff)
        .expect(200)

      expect(response.body).to.eql({ ok: true })
    })

    it('index the tx', async () => {
      const server = get.server
      const tx = await get.tx

      await request(server.app)
        .post('/tx')
        .set('content-type', 'application/octet-stream')
        .send(tx.buff)
        .expect(200)

      const savedTx = await get.blobs.pullTx(tx.txid)
      expect(Buffer.compare(savedTx, tx.buff)).to.eql(0)
      expect(await get.ds.txIsIndexed(tx.txid)).to.eql(true)
    })

    describe('when the run execution fails', function () {
      def('network', () => 'main') // this causes the run execution to fail.

      it('returns false in the body', async () => {
        const server = get.server
        const tx = await get.tx

        const response = await request(server.app)
          .post('/tx')
          .set('content-type', 'application/octet-stream')
          .send(tx.buff)
          .expect(200)

        expect(response.body).to.eql({ ok: false })
      })
    })

    // ------------------------------------------------------------------------
  })

  // --------------------------------------------------------------------------
  // post trust
  // --------------------------------------------------------------------------

  describe('post trust', () => {
    it('return list of trusted txids', async () => {
      const server = get.server
      const txid = Buffer.alloc(32).fill(1).toString('hex')

      const response = await request(server.app)
        .post('/trust')
        .set('content-type', 'application/json')
        .send({ txid, trust: true })
        .expect(200)

      expect(response.body).to.eql({ trusted: [txid], untrusted: [] })
    })

    it('does not returns anything when tx was not trusted before and tust is false', async () => {
      const server = get.server
      const txid = Buffer.alloc(32).fill(1).toString('hex')

      const response = await request(server.app)
        .post('/trust')
        .set('content-type', 'application/json')
        .send({ txid, trust: false })
        .expect(200)

      expect(response.body).to.eql({ trusted: [], untrusted: [txid] })
    })

    it('returns untrusted txid when txid was actually trusted before', async () => {
      const server = get.server
      const txid = Buffer.alloc(32).fill(1).toString('hex')

      await request(server.app)
        .post('/trust')
        .set('content-type', 'application/json')
        .send({ txid, trust: true })
        .expect(200)

      const response = await request(server.app)
        .post('/trust')
        .set('content-type', 'application/json')
        .send({ txid, trust: false })
        .expect(200)

      expect(response.body).to.eql({ trusted: [], untrusted: [txid] })
    })
  })

  // --------------------------------------------------------------------------
  // get jig
  // --------------------------------------------------------------------------

  describe('get jig', () => {
    describe('when the jig was indexed before', () => {
      beforeEach(async () => {
        const server = get.server
        const tx = await get.someRunTx

        await request(server.app)
          .post('/trust')
          .set('content-type', 'application/json')
          .send({ txid: tx.txid, trust: true })
          .expect(200)

        await request(server.app)
          .post('/tx')
          .set('content-type', 'application/octet-stream')
          .send(tx.buff)
          .expect(200)
      })

      it('returns a jig state if known', async () => {
        const server = get.server
        //
        const tx = await get.someRunTx
        const location = `${tx.txid}_o1`

        const response = await request(server.app)
          .get(`/jig/${location}`)
          .expect(200)

        expect(response.body.props.location).to.eql('_o1')
      })
    })

    describe('when the jig was not indexed before', async () => {
      it('returns 404', async () => {
        const server = get.server
        const tx = await get.someRunTx
        const location = `${tx.txid}_o1`

        const response = await request(server.app)
          .get(`/jig/${location}`)
          .expect(404)

        expect(response.body).to.eql({ code: 'not-found', message: 'jig not found', data: { location } })
      })
    })
  })

  // --------------------------------------------------------------------------
  // get berry
  // --------------------------------------------------------------------------

  describe('get berry', () => {
    it('returns 404 when the berry is unknown', async () => {
      const server = get.server
      const location = 'unknownberry'
      const response = await request(server.app)
        .get(`/berry/${location}`)
        .expect(404)
      expect(response.body).to.eql({ code: 'not-found', message: 'berry not found', data: { location } })
    })

    describe('when the berry was known from before', async () => {
      def('randomTx', async () => {
        const randomTxTxid = await get.run.blockchain.fund(bsv.PrivateKey.fromRandom().toAddress(), 10000)
        return {
          txid: randomTxTxid,
          hex: await get.run.blockchain.fetch(randomTxTxid)
        }
      })

      def('data', async () => {
        const randomTx = await get.randomTx
        const TxSize = buildTxSize()
        const Container = buildContainer()
        await get.run.transaction(() => {
          get.run.deploy(TxSize)
          get.run.deploy(Container)
        })
        await get.run.sync()

        const aBerry = await TxSize.load(randomTx.txid)
        const aContainer = new Container(aBerry)
        await aContainer.sync()

        const deployTxid = TxSize.location.split('_')[0]
        const containerTxid = Container.location.split('_')[0]
        const intanceTxid = aContainer.location.split('_')[0]

        return {
          randomTx: { buff: Buffer.from(randomTx.hex, 'hex'), txid: randomTx.txid },
          deploy: { buff: Buffer.from(Buffer.from(await get.run.blockchain.fetch(deployTxid), 'hex')), txid: containerTxid },
          instance: { buff: Buffer.from(await get.run.blockchain.fetch(intanceTxid), 'hex'), txid: intanceTxid },
          berry: aBerry
        }
      })

      beforeEach(async () => {
        const {
          randomTx,
          deploy,
          instance
        } = await get.data

        await get.blobs.pushTx(randomTx.txid, randomTx.buff)

        await get.indexer.trust(deploy.txid)
        await get.indexer.indexTransaction(randomTx.buff)
        await get.indexer.indexTransaction(deploy.buff)
        await get.indexer.indexTransaction(instance.buff)
      })

      it('returns the state if the state exists', async () => {
        const { berry } = await get.data
        const server = get.server
        const location = berry.location.replace(/&hash=[a-fA-F0-9]*/, '')
        const response = await request(server.app)
          .get(`/berry/${encodeURIComponent(location)}`)
          .expect(200)

        expect(response.body.props).to.have.keys([
          'nonce',
          'satoshis',
          'location',
          'origin',
          'size',
          'owner'
        ])
      })
    })

    // it('returns state if exists', async () => {
    //   const executor = new Executor('main', 1, database, logger)
    //   const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
    //   const server = buildMainServer(database, logger)
    //   await indexer.start()
    //   await server.start()
    //   await database.addTransaction('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
    //   await indexed(indexer, 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
    //   const location = '24cde3638a444c8ad397536127833878ffdfe1b04d5595489bd294e50d77105a_o1?berry=2f3492ef5401d887a93ca09820dff952f355431cea306841a70d163e32b2acad&version=5'
    //   const state = (await axios.get(`http://localhost:${server.port}/berry/${encodeURIComponent(location)}`)).data
    //   expect(typeof state).to.equal('object')
    //   expect(state.kind).to.equal('berry')
    //   server.stop()
    //   await indexer.stop()
    // })

    // ------------------------------------------------------------------------

    // it('returns 404 if missing', async () => {
    //   const executor = new Executor('main', 1, database, logger)
    //   const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
    //   const server = buildMainServer(database, logger)
    //   await indexer.start()
    //   await server.start()
    //   const location = '24cde3638a444c8ad397536127833878ffdfe1b04d5595489bd294e50d77105a_o1?berry=2f3492ef5401d887a93ca09820dff952f355431cea306841a70d163e32b2acad&version=5'
    //   await expect(axios.get(`http://localhost:${server.port}/berry/${location}`)).to.be.rejectedWith(Error)
    //   try {
    //     await axios.get(`http://localhost:${server.port}/berry/${location}`)
    //   } catch (e) {
    //     expect(e.response.status).to.equal(404)
    //   }
    //   server.stop()
    //   await indexer.stop()
    // })
  })

  // --------------------------------------------------------------------------
  // get tx
  // --------------------------------------------------------------------------

  describe.skip('get tx', () => {
    it('returns rawtx if downloaded', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const txid = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102'
      const promise = downloaded(indexer, txid)
      await database.addTransaction(txid)
      await promise
      const rawtx = (await axios.get(`http://localhost:${server.port}/tx/${txid}`)).data
      expect(typeof rawtx).to.equal('string')
      expect(rawtx.length).to.equal(2074)
      server.stop()
      await indexer.stop()
    })

    // ------------------------------------------------------------------------

    it('returns 404 if missing', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const txid = '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102'
      await expect(axios.get(`http://localhost:${server.port}/tx/${txid}`)).to.be.rejectedWith(Error)
      try {
        await axios.get(`http://localhost:${server.port}/tx/${txid}`)
      } catch (e) {
        expect(e.response.status).to.equal(404)
      }
      server.stop()
      await indexer.stop()
    })

    // ------------------------------------------------------------------------

    it('returns 404 if not downloaded', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const txid = '1111111111111111111111111111111111111111111111111111111111111111'
      database.addTransaction(txid)
      await expect(axios.get(`http://localhost:${server.port}/tx/${txid}`)).to.be.rejectedWith(Error)
      try {
        await axios.get(`http://localhost:${server.port}/tx/${txid}`)
      } catch (e) {
        expect(e.response.status).to.equal(404)
      }
      server.stop()
      await indexer.stop()
    })
  })

  // --------------------------------------------------------------------------
  // get unspent
  // --------------------------------------------------------------------------

  describe.skip('get unspent', () => {
    it('query all unspent', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const promise = indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await promise
      const unspent = (await axios.get(`http://localhost:${server.port}/unspent`)).data
      expect(unspent.length).to.equal(3)
      expect(unspent.includes('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64_o1')).to.equal(true)
      expect(unspent.includes('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64_o2')).to.equal(true)
      expect(unspent.includes('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102_o1')).to.equal(true)
      server.stop()
      await indexer.stop()
    })

    // ------------------------------------------------------------------------

    it('query unspent by address', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 1, 1, logger, 0, Infinity, DEFAULT_TRUSTLIST)
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const promise = indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await database.addTransaction('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
      await promise
      const address = '1Kc8XRNryDycwvfEQiFF2TZwD1CVhgwGy2'
      const unspent = (await axios.get(`http://localhost:${server.port}/unspent?address=${address}`)).data
      expect(unspent.length).to.equal(3)
      server.stop()
      await indexer.stop()
    })
  })

  // --------------------------------------------------------------------------
  // misc
  // --------------------------------------------------------------------------

  describe.skip('misc', () => {
    it('cors', async () => {
      const executor = new Executor('main', 1, database, logger)
      const indexer = new Indexer(database, api, executor, 'main', 1, logger, 0, Infinity, [])
      const server = buildMainServer(database, logger)
      await indexer.start()
      await server.start()
      const opts = { headers: { Origin: 'https://www.google.com' } }
      const resp = (await axios.get(`http://localhost:${server.port}/status`, opts))
      expect(resp.headers['access-control-allow-origin']).to.equal('*')
      server.stop()
      await indexer.stop()
    })
  })
})

// ------------------------------------------------------------------------------------------------
