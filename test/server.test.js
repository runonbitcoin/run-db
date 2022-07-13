/* global caller */
/**
 * server.test.js
 *
 * Tests for src/server.test.js
 */

const { describe, it, beforeEach, afterEach } = require('mocha')
require('chai').use(require('chai-as-promised'))
const request = require('supertest')
const { expect } = require('chai')
const Indexer = require('../src/indexer')
const { buildMainServer } = require('../src/http/build-main-server')
const { Executor } = require('../src/execution/executor')
const { def, get } = require('bdd-lazy-var/getter')
const { DbTrustList } = require('../src/trust-list/db-trust-list')
const Run = require('run-sdk')
const { buildCounter } = require('./test-jigs/counter')
const { buildTxSize } = require('./test-jigs/tx-size')
const { buildContainer } = require('./test-jigs/container')
const bsv = require('bsv')
const { ExecutionWorker } = require('../src/execution-worker')
const { MemoryQueue } = require('../src/queues/memory-queu')
const { ExecutionManager } = require('../src/execution-manager')
const { ExecutingSet } = require('../src/executing-set')
const { buildBlobs, buildDs } = require('./test-env')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

// ------------------------------------------------------------------------------------------------
// Server
// ------------------------------------------------------------------------------------------------

describe('Server', () => {
  def('ds', () => buildDs())

  def('blobs', () => buildBlobs())
  def('network', () => 'test')
  def('executor', () => new Executor(get.network, 1, get.blobs, get.ds, logger, {}))
  def('trustList', () => new DbTrustList())
  def('execSet', () => new ExecutingSet(get.ds))
  def('indexer', () => new Indexer(get.ds, get.blobs, get.trustList, get.executor, get.network, logger))

  def('execQueue', () => new MemoryQueue())
  def('trustQueue', () => new MemoryQueue())
  def('postIndexQueue', () => new MemoryQueue())
  def('worker', () => new ExecutionWorker(get.indexer, get.execSet, get.execQueue, get.trustQueue, get.postIndexQueue))
  def('execManager', () => new ExecutionManager(get.blobs, get.execQueue, get.trustQueue, get.execSet))

  def('run', () => new Run({ network: 'mock', cache: new Map() }))

  def('counterClass', async () => {
    const Counter = buildCounter()
    const Deployed = get.run.deploy(Counter)
    await get.run.sync()
    return Deployed
  })

  def('someRunTx', async () => {
    const Counter = await get.counterClass
    const txid = Counter.location.split('_')[0]
    return {
      txid,
      buff: Buffer.from(await get.run.blockchain.fetch(txid), 'hex')
    }
  })

  def('server', () => {
    const server = buildMainServer(get.ds, get.blobs, get.execManager, logger)
    server.prepare()
    return server
  })

  beforeEach(async () => {
    await get.ds.setUp()
    await get.blobs.setUp()
    await get.executor.start()
    await get.indexer.start()

    await get.execManager.setUp()
    await get.worker.setUp()
  })

  afterEach(async () => {
    await get.server.stop()
    await get.worker.tearDown()
    await get.execManager.tearDown()
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

      // The execution fails but still happens and gets indexed.
      it('returns true in the body', async () => {
        const server = get.server
        const tx = await get.tx

        const response = await request(server.app)
          .post('/tx')
          .set('content-type', 'application/octet-stream')
          .send(tx.buff)
          .expect(200)

        expect(response.body).to.eql({ ok: true })
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
  })

  // --------------------------------------------------------------------------
  // get tx
  // --------------------------------------------------------------------------

  describe('get tx', () => {
    describe('when the tx is kwnown', () => {
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

      it('returns the tx as a buffer', async () => {
        const tx = await get.someRunTx
        const response = await request(get.server.app)
          .get(`/tx/${tx.txid}`)
          .set('content-type', 'application/octet-stream')
          .expect(200)

        expect(Buffer.compare(response.body, tx.buff)).to.eql(0)
      })
    })

    describe('when the tx was not known from before', function () {
      it('returns 404', async () => {
        const tx = await get.someRunTx
        await request(get.server.app)
          .get(`/tx/${tx.txid}`)
          .set('content-type', 'application/octet-stream')
          .expect(404)
      })
    })
  })

  // --------------------------------------------------------------------------
  // get unspent
  // --------------------------------------------------------------------------

  describe('get unspent', () => {
    def('tokenClass', async () => {
      class SomeToken extends Run.Jig {
        init (owner, amount) {
          // Make sure we are calling from ourself
          const minting = caller === this.constructor
          const sending = caller && caller.constructor === this.constructor
          if (!minting && !sending) throw new Error('Must create token using mint()')

          this.owner = owner
          this.amount = amount
        }

        send (newOwner, amount) {
          if (this.amount < amount) {
            throw new Error('not enough balance')
          }
          this.amount = this.amount - amount
          return new SomeToken(newOwner, amount)
        }

        static mint (amount) {
          return new this(this.owner, amount)
        }
      }
      const Deployed = get.run.deploy(SomeToken)
      await get.run.sync()
      return Deployed
    })

    def('aToken', async () => {
      const SomeToken = await get.tokenClass

      const instance = await get.run.transaction(() => {
        return SomeToken.mint(10)
      })
      await get.run.sync()
      return instance
    })

    def('anAddress', () => {
      const privKey = bsv.PrivateKey.fromRandom()
      return bsv.Address.fromPrivateKey(privKey, 'testnet').toString()
    })

    def('anotherToken', async () => {
      const token = await get.aToken
      const anotherToken = token.send(get.anAddress, 1)
      await get.run.sync()
      return anotherToken
    })

    def('aCounter', async () => {
      const Counter = await get.counterClass
      const instance = new Counter()
      await instance.sync()
      return instance
    })
    function txidFromLoc (loc) {
      return loc.split('_')[0]
    }

    beforeEach(async () => {
      const Counter = await get.counterClass
      const SomeToken = await get.tokenClass
      const aToken = await get.aToken
      const anotherToken = await get.anotherToken
      const aCounter = await get.aCounter

      await request(get.server.app)
        .post('/trust')
        .set('content-type', 'application/json')
        .send({ txid: txidFromLoc(Counter.location), trust: true })
        .expect(200)
      await request(get.server.app)
        .post('/trust')
        .set('content-type', 'application/json')
        .send({ txid: txidFromLoc(SomeToken.location), trust: true })
        .expect(200)
      await request(get.server.app)
        .post('/trust')
        .set('content-type', 'application/json')
        .send({ txid: txidFromLoc(SomeToken.origin), trust: true })
        .expect(200)

      const txids = [
        Counter.location,
        SomeToken.origin,
        aToken.origin,
        anotherToken.location,
        aCounter.location
      ].map(txidFromLoc)

      for (const txid of txids) {
        const hex = await get.run.blockchain.fetch(txid)
        const buff = Buffer.from(hex, 'hex')
        await request(get.server.app)
          .post('/tx')
          .set('content-type', 'application/octet-stream')
          .send(buff)
          .expect(200)
      }
    })

    it('can return all unspent', async () => {
      const Counter = await get.counterClass
      const SomeToken = await get.tokenClass
      const aToken = await get.aToken
      const anotherToken = await get.anotherToken
      const aCounter = await get.aCounter

      const response = await request(get.server.app)
        .get('/unspent')
        .expect(200)
      const updatedClass = await get.run.load(SomeToken.origin)
      await updatedClass.sync()
      expect(response.body).to.have.length(5)
      expect(response.body).to.include(Counter.location)
      expect(response.body).to.include(updatedClass.location)
      expect(response.body).to.include(anotherToken.location)
      expect(response.body).to.include(aToken.location)
      expect(response.body).to.include(aCounter.location)
      expect(response.body).to.include(aCounter.location)
    })

    // ------------------------------------------------------------------------

    it('query unspent by address', async () => {
      const anotherToken = await get.anotherToken

      const response = await request(get.server.app)
        .get(`/unspent?address=${get.anAddress}`)
        .expect(200)

      expect(response.body).to.have.length(1)
      expect(response.body).to.include(anotherToken.location)
    })

    it('query unspent by class origin', async () => {
      const tokenClass = await get.tokenClass
      const aToken = await get.aToken
      const anotherToken = await get.anotherToken

      const response = await request(get.server.app)
        .get(`/unspent?class=${tokenClass.origin}`)
        .expect(200)

      expect(response.body).to.have.length(2)
      expect(response.body).to.include(anotherToken.location)
      expect(response.body).to.include(aToken.location)
    })

    it('query unspent by class origin and address', async () => {
      const counterClass = await get.counterClass
      const aCounter = await get.aCounter

      const response = await request(get.server.app)
        .get(`/unspent?class=${counterClass.origin}&address=${aCounter.owner}`)
        .expect(200)

      expect(response.body).to.have.length(1)
      expect(response.body).to.include(aCounter.location)
    })

    it('query unspent by class origin and address when no possible results returns empty', async () => {
      const counterClass = await get.counterClass

      const response = await request(get.server.app)
        .get(`/unspent?class=${counterClass.origin}&address=${get.anAddress}`)
        .expect(200)

      expect(response.body).to.have.length(0)
    })
  })
})

// ------------------------------------------------------------------------------------------------
