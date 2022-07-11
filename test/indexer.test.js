/**
 * indexer.test.js
 *
 * Tests for the Indexer
 */

const { describe, it, beforeEach, afterEach } = require('mocha')
const { expect } = require('chai')
const bsv = require('bsv')
const nimble = require('@runonbitcoin/nimble')
const Indexer = require('../src/indexer')
const Run = require('run-sdk')
// const { DEFAULT_TRUSTLIST } = require('../src/config')
const { DbTrustList } = require('../src/trust-list/db-trust-list')
const { Executor } = require('../src/execution/executor')
const { def, get } = require('bdd-lazy-var/getter')
const { buildTxSize } = require('./test-jigs/tx-size')
const { buildDs, buildBlobs } = require('./test-env')
const { buildCounter } = require('./test-jigs/counter')
const { ExecutingSet } = require('../src/executing-set')
const { txidFromLocation } = require('../src/util/txid-from-location')
const { buildContainer } = require('./test-jigs/container')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

describe('Indexer', () => {
  def('ds', buildDs)

  let trustList
  let blobStorage

  def('filter', () => ({
    serialize: JSON.stringify,
    deserialize: JSON.parse
  }))

  def('trustList', () => {
    return new DbTrustList()
  })

  def('blobs', () => buildBlobs())

  beforeEach(async () => {
    trustList = get.trustList
    blobStorage = get.blobs
    await get.ds.setUp()
    await get.blobs.setUp()
  })

  afterEach(async () => {
    await get.ds.tearDown()
    await get.blobs.tearDown()
  })

  describe('#indexTransaction', () => {
    def('appName', () => 'unittest')
    def('run', () => new Run({ network: 'mock', app: get.appName }))
    def('txBuf', async () => Buffer.from(
      await get.txHex,
      'hex'
    ))

    def('TxSize', async () => {
      const TxSize = buildTxSize()

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
      const Counter = buildCounter()

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
      return new Executor('test', 1, blobStorage, get.ds, logger)
    })

    def('execSet', () => new ExecutingSet(get.ds))

    def('ignoredApps', () => [])
    def('indexer', () =>
      new Indexer(get.ds, blobStorage, trustList, get.executor, 'test', get.execSet, logger, get.ignoredApps)
    )

    beforeEach(async () => {
      await blobStorage.pushTx(null, await get.txBuf)

      await get.executor.start()
    })

    afterEach(async () => {
      await get.indexer.stop()
      await get.executor.stop()
    })

    describe('when the tx is executable and has no dependencies and the code was trusted', () => {
      beforeEach(async () => {
        const Counter = await get.Counter
        await get.indexer.trust(txidFromLocation(Counter.location))
      })
      it('pushes the jigs to blob storage', async () => {
        const indexer = get.indexer
        const Counter = await get.Counter

        await indexer.trust(Counter.location.split('_')[0])

        await indexer.indexTransaction(await get.txBuf, null, null)

        const counterState = await blobStorage.pullJigState(Counter.location, () => expect.fail('state should be present'))
        expect(counterState.src).to.eql(Counter.toString().replace('Run.Jig', 'Jig'))
      })

      it('saves jig metadata', async () => {
        const indexer = get.indexer
        const Counter = await get.Counter

        await indexer.trust(Counter.location.split('_')[0])

        await indexer.indexTransaction(await get.txBuf, null, null)

        const counterState = await get.ds.getJigMetadata(Counter.location)
        expect(counterState.scripthash).not.to.eql(null)
        expect(counterState.scripthash).not.to.eql(undefined)
      })

      it('returns executed as true', async () => {
        const Counter = await get.Counter

        const txid = txidFromLocation(Counter.location)
        await get.indexer.trust(txid)

        const response = await get.indexer.indexTransaction(await get.txBuf, null, null)

        expect(response.executed).to.eql(true)
      })

      it('craetes the spend', async () => {
        const Counter = await get.Counter

        const txid = txidFromLocation(Counter.location)
        await get.indexer.trust(txid)

        await get.indexer.indexTransaction(await get.txBuf, null, null)

        expect(await get.ds.getSpendingTxid(`${txid}_o1`)).to.eql(null)
        expect(await get.ds.getSpendingTxid(`${txid}_o2`)).to.eql(null)
        expect(await get.ds.searchSpendsForTx(txid)).to.have.length(1)
      })

      it('creates the jigs', async () => {
        const Counter = await get.Counter

        const txid = txidFromLocation(Counter.location)
        await get.indexer.trust(txid)
        const txHex = await get.run.blockchain.fetch(txid)

        await get.indexer.indexTransaction(await get.txBuf, null, null)
        const metadata1 = await get.ds.getJigMetadata(`${txid}_o1`)
        expect(metadata1.location).to.eql(`${txid}_o1`)
        expect(metadata1.class).to.eql('native://Code')
        expect(metadata1.lock).to.eql(null)
        const script = nimble.classes.Transaction.fromHex(txHex).outputs[1].script
        const sha256 = Buffer.from(nimble.functions.sha256(script.toBuffer())).reverse()
        expect(metadata1.scripthash).to.eql(sha256.toString('hex'))
      })

      // describe('when the tx is in the exec set', () => {
      //   it('removes the tx from exec set', async () => {
      //     const Counter = await get.Counter
      //     const txid = txidFromLocation(Counter.location)
      //     await get.indexer.trust(txid)
      //
      //     await get.execSet.add(txid)
      //     expect(await get.execSet.check(txid)).to.eql(true)
      //     await get.indexer.indexTransaction(await get.txBuf, null, null)
      //     const coso = await get.execSet.check(txid)
      //     expect(coso).to.eql(false)
      //   })
      // })
    })

    describe('when the tx execution fails because there is a missing state on the blob storage', async () => {
      it('returns the missing tx associated to the missing state as a missing dep', async () => {
        const Counter = await get.Counter
        const instance = new Counter()
        await instance.sync()

        const txid1 = Counter.location.split('_')[0]
        const txid2 = instance.location.split('_')[0]
        const txHex1 = await get.run.blockchain.fetch(txid1)
        const txHex2 = await get.run.blockchain.fetch(txid2)

        const txBuf1 = Buffer.from(txHex1, 'hex')
        const txBuf2 = Buffer.from(txHex2, 'hex')

        await get.indexer.trust(txid1)
        await get.indexer.indexTransaction(txBuf1)

        await get.blobs.knex('jig_states').where('location', Counter.location).del()
        await get.blobs.knex('raw_transactions').where('txid', Counter.location.split('_')[0]).del()

        const result = await get.indexer.indexTransaction(txBuf2)
        expect(result.executed).to.eql(false)
        expect(result.missingDeps).to.eql([txidFromLocation(Counter.location)])
      })
    })

    describe('when the tx deletes a jig', () => {
      it('saves the deleted jig', async () => {
        class CanBeDeleted extends Run.Jig {
          deleteMe () {
            this.destroy()
          }
        }

        get.run.deploy(CanBeDeleted)
        await get.run.sync()

        const instance = new CanBeDeleted()
        await instance.sync()

        instance.deleteMe()
        await get.run.sync()

        const txid1 = CanBeDeleted.location.split('_')[0]
        const txid2 = instance.origin.split('_')[0]
        const txid3 = instance.location.split('_')[0]
        await get.indexer.trust(txid1)

        const hex1 = await get.run.blockchain.fetch(txid1)
        const hex2 = await get.run.blockchain.fetch(txid2)
        const hex3 = await get.run.blockchain.fetch(txid3)

        const buff1 = Buffer.from(hex1, 'hex')
        const buff2 = Buffer.from(hex2, 'hex')
        const buff3 = Buffer.from(hex3, 'hex')

        await get.indexer.indexTransaction(buff1)
        await get.indexer.indexTransaction(buff2)
        await get.indexer.indexTransaction(buff3)

        const savedState = await blobStorage.pullJigState(instance.location, () => expect.fail('should be present'))
        expect(savedState.props.origin).to.eql(instance.origin)
        expect(savedState.props.location).to.match(/_d0$/)
      })

      it('does not include deleted on unspent', async () => {
        // this test should not be here.
        class CanBeDeleted extends Run.Jig {
          deleteMe () {
            this.destroy()
          }
        }

        get.run.deploy(CanBeDeleted)
        await get.run.sync()

        const instance = new CanBeDeleted()
        await instance.sync()

        instance.deleteMe()
        await get.run.sync()

        const txid1 = CanBeDeleted.location.split('_')[0]
        const txid2 = instance.origin.split('_')[0]
        const txid3 = instance.location.split('_')[0]
        await get.indexer.trust(txid1)

        const hex1 = await get.run.blockchain.fetch(txid1)
        const hex2 = await get.run.blockchain.fetch(txid2)
        const hex3 = await get.run.blockchain.fetch(txid3)

        const buff1 = Buffer.from(hex1, 'hex')
        const buff2 = Buffer.from(hex2, 'hex')
        const buff3 = Buffer.from(hex3, 'hex')

        await get.indexer.indexTransaction(buff1)
        await get.indexer.indexTransaction(buff2)
        await get.indexer.indexTransaction(buff3)

        const all = await get.ds.getAllUnspent()
        expect(all).to.eql([CanBeDeleted.location]) // deleted is not in the list, only class
      })
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

      it('adds the berry tx in the list of unknown deps', async () => {
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
        expect(result.unknownDeps).to.include(Container.location.split('_')[0])
        expect(result.unknownDeps).to.include(TxSize.location.split('_')[0])
        expect(result.unknownDeps).to.include(randomTx.txid)
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

      it('it marks the tx as indexed', async () => {
        await get.indexer.indexTransaction(await get.txBuf, null, null)
        const indexed = await get.ds.txIsIndexed(get.tx.hash)
        expect(!!indexed).to.eq(true)
      })

      it('creates the spends', async () => {
        const txid = (await get.tx).hash
        await get.indexer.indexTransaction(await get.txBuf, null, null)
        expect(await get.ds.getSpendingTxid(`${txid}_o0`)).to.eql(null)
        expect(await get.ds.searchSpendsForTx(txid)).to.have.length(1)
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
        expect(response.unknownDeps).to.eql([depTxid])
      })
    })

    describe('when the tx has more than one dep that was not executed before', async () => {
      def('Container', async () => {
        const Container = buildContainer()
        get.run.deploy(Container)
        await get.run.sync()
        return Container
      })

      def('txHex', async () => {
        const Counter = await get.Counter
        const Container = await get.Container
        const aContainer = new Container(Counter)
        await aContainer.sync()
        const txid = aContainer.location.split('_')[0]
        return get.run.blockchain.fetch(txid)
      })

      it('return all the non executed deps as missing deps', async () => {
        const Counter = await get.Counter
        const Container = await get.Container
        const jig = get.run.inventory.jigs[0]

        const txid1 = txidFromLocation(Counter.location)
        const buff1 = Buffer.from(await get.run.blockchain.fetch(txid1), 'hex')
        await get.blobs.pushTx(txid1, buff1)

        const txid2 = txidFromLocation(Container.location)
        const buff2 = Buffer.from(await get.run.blockchain.fetch(txid2), 'hex')
        await get.blobs.pushTx(txid2, buff2)

        const txid3 = txidFromLocation(jig.location)
        const buff3 = Buffer.from(await get.run.blockchain.fetch(txid3), 'hex')
        await get.blobs.pushTx(txid3, buff3)

        await get.indexer.trust(txid1)
        await get.indexer.trust(txid2)

        await get.indexer.indexTransaction(buff1)
        await get.indexer.indexTransaction(buff2)

        await get.ds.setExecutedForTx(txid1, false)
        await get.ds.setExecutedForTx(txid2, false)

        await get.indexer.indexTransaction(await get.txBuf, null, null)

        const response = await get.indexer.indexTransaction(buff3, null, null)
        expect(response.missingDeps).to.have.members([txid1, txid2])
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

      it('returns that was executed', async () => {
        const indexer = get.indexer
        const response = await indexer.indexTransaction(await get.txBuf, null, null)

        expect(response.executed).to.eql(true)
      })

      it('marks the tx as failed', async () => {
        const Counter = await get.Counter
        const indexer = get.indexer
        await indexer.indexTransaction(await get.txBuf, null, null)

        const tx = await get.ds.getTx(txidFromLocation(Counter.location), () => expect.fail('should be present'))
        expect(tx.hasFailed()).to.eql(true)
      })
    })

    describe('when the tx depends on another tx that was not trusted', () => {
      def('instance', async () => {
        const Counter = await get.Counter
        const instance = new Counter()
        await instance.sync()
        return instance
      })
      def('txHex', async () => {
        const instance = await get.instance
        return get.run.blockchain.fetch(txidFromLocation(instance.location))
      })

      beforeEach(async () => {
        const Counter = await get.Counter
        const hex = await get.run.blockchain.fetch(txidFromLocation(Counter.location))
        await get.indexer.indexTransaction(Buffer.from(hex, 'hex'))
      })

      it('does not save anything to the blob storage', async () => {
        const indexer = get.indexer
        const instance = await get.instance

        await indexer.indexTransaction(await get.txBuf, null, null)

        const obj = {}
        const response = await blobStorage.pullJigState(instance.location, () => obj)
        expect(response).to.eq(obj)
      })

      it('returns executed', async () => { // because this is the final exec state in this trust state
        const indexer = get.indexer
        const response = await indexer.indexTransaction(await get.txBuf, null, null)

        expect(response.executed).to.eql(true)
      })

      it('does not return the untrusted dep as unknown dep', async () => {
        const indexer = get.indexer
        const response = await indexer.indexTransaction(await get.txBuf, null, null)

        expect(response.unknownDeps).to.eql([])
      })

      it('does not return the untrusted dep as missing deps', async () => {
        const indexer = get.indexer
        const response = await indexer.indexTransaction(await get.txBuf, null, null)

        expect(response.missingDeps).to.eql([])
      })

      it('marks the tx as failed', async () => {
        const instance = await get.instance
        const indexer = get.indexer
        await indexer.indexTransaction(await get.txBuf, null, null)

        const tx = await get.ds.getTx(txidFromLocation(instance.location), () => expect.fail('should be present'))
        expect(tx.hasFailed()).to.eql(true)
      })
    })

    describe('when the execution enables another execution', () => {
      def('instance', async () => {
        const Counter = await get.Counter
        const instance = new Counter()
        await instance.sync()
        return instance
      })
      def('txHex', async () => {
        const Counter = await get.Counter
        return get.run.blockchain.fetch(txidFromLocation(Counter.location))
      })

      beforeEach(async () => {
        const Counter = await get.Counter
        await get.indexer.trust(txidFromLocation(Counter.location))

        const instance = await get.instance
        const hex = await get.run.blockchain.fetch(txidFromLocation(instance.location))
        await get.indexer.indexTransaction(Buffer.from(hex, 'hex'))
      })

      it('executes inmediately', async () => {
        const result = await get.indexer.indexTransaction(await get.txBuf, null)
        expect(result.executed).to.eql(true)
        expect(result.success).to.eql(true)
      })

      it('returns the enablement', async () => {
        const instance = await get.instance

        const result = await get.indexer.indexTransaction(await get.txBuf, null)
        expect(result.executed).to.eql(true)
        expect(result.enables).to.eql([txidFromLocation(instance.location)])
      })
    })

    describe('when 2 txs depends on the current txs but one of them has other non executed txs', () => {
      def('Container', async () => {
        const Container = buildContainer()
        get.run.deploy(Container)
        await get.run.sync()
        return Container
      })

      def('aContainer', async () => {
        const Container = await get.Container
        const Counter = await get.Counter
        const instance = new Container(Counter)
        await instance.sync()
        return instance
      })

      def('anotherContainer', async () => {
        const Container = await get.Container
        const instance = new Container('something')
        await instance.sync()
        return instance
      })

      def('txHex', async () => {
        const Container = await get.Container
        return get.run.blockchain.fetch(txidFromLocation(Container.location))
      })

      beforeEach(async () => {
        const aContainer = await get.aContainer
        const anotherContainer = await get.anotherContainer

        for (const jig of [aContainer, anotherContainer]) {
          const txid1 = txidFromLocation(jig.location)
          const txHex = await get.run.blockchain.fetch(txid1)
          const txBuf = Buffer.from(txHex, 'hex')
          await get.indexer.indexTransaction(txBuf)
        }

        await get.indexer.trust(txidFromLocation(aContainer.constructor.location))
      })

      it('does not includes that as an enablement', async () => {
        const anotherContainer = await get.anotherContainer // does not depend on other jig.

        const result = await get.indexer.indexTransaction(await get.txBuf)
        expect(result.enables).to.have.length(1)
        expect(result.enables).to.eql([txidFromLocation(anotherContainer.location)])
      })

      it('executes immediately', async () => {
        const result = await get.indexer.indexTransaction(await get.txBuf)
        expect(result.executed).to.eql(true)
      })
    })

    describe('when the app is ignored', () => {
      def('appName', () => 'ignoredApp')
      def('ignoredApps', () => [get.appName])

      beforeEach(async () => {
        const Counter = await get.Counter
        await get.indexer.trust(Counter.location.split('_')[0])
      })

      it('returns as it were already executed', async () => {
        const response = await get.indexer.indexTransaction(await get.txBuf, null, null)

        const instance = new (await get.Counter)()
        await instance.sync()

        const txid = instance.location.split('_')[0]
        const txHex = await get.run.blockchain.fetch(txid)
        const txBuf2 = Buffer.from(txHex, 'hex')

        const response2 = await get.indexer.indexTransaction(await txBuf2, null, null)

        expect(response.executed).to.eql(true)
        expect(response.enables).to.eql([])
        expect(response.missingDeps).to.eql([])
        expect(response.unknownDeps).to.eql([])

        expect(response2.executed).to.eql(true)
        expect(response2.enables).to.eql([])
        expect(response2.missingDeps).to.eql([])
        expect(response2.unknownDeps).to.eql([])
      })

      it('marks the tx as failed', async () => {
        const Counter = await get.Counter
        const txid = txidFromLocation(Counter.location)
        await get.ds.addNewTx(txid, null, null)
        await get.indexer.indexTransaction(await get.txBuf, null, null)
        const tx = await get.ds.getTx(txid)
        expect(tx.hasFailed()).to.eql(true)
      })
    })

    describe('when there is 2 txs downstream, one enabled and another one not enabled', () => {
      def('tx1', async () => {
        const Container = buildContainer()
        get.run.deploy(Container)
        await get.run.sync()
        const txid = txidFromLocation(Container.location)
        const hex = await get.run.blockchain.fetch(txid)

        return { Container, tx: { txid, buff: Buffer.from(hex, 'hex') } }
      })
      def('tx2', async () => {
        const { Container } = await get.tx1
        const instance = new Container('holu')
        await instance.sync()

        const txid = txidFromLocation(instance.location)
        const hex = await get.run.blockchain.fetch(txid)

        return { instance, tx: { txid, buff: Buffer.from(hex, 'hex') } }
      })

      def('txDep', async () => {
        const Counter = await get.Counter
        const instance = new Counter()
        await instance.sync()

        const txid = txidFromLocation(instance.location)
        const hex = await get.run.blockchain.fetch(txid)

        return { instance, tx: { txid, buff: Buffer.from(hex, 'hex') } }
      })

      def('tx3', async () => {
        const { Container } = await get.tx1
        const { instance: aCounter } = await get.txDep
        const instance = new Container(aCounter)
        await instance.sync()

        const txid = txidFromLocation(instance.location)
        const hex = await get.run.blockchain.fetch(txid)

        return { instance, tx: { txid, buff: Buffer.from(hex, 'hex') } }
      })

      it('only queues only the enabled one', async () => {
        const { tx: tx1 } = await get.tx1
        const { tx: tx2 } = await get.tx2
        const { tx: txDep } = await get.txDep
        const { tx: tx3 } = await get.tx3

        await get.indexer.trust(tx1.txid)

        expect(await get.ds.txIsExecuted(txidFromLocation((await get.Counter).location))).to.eql(false)

        await get.indexer.indexTransaction(await tx2.buff, null)
        await get.indexer.indexTransaction(await tx3.buff, null)
        await get.indexer.indexTransaction(await txDep.buff, null)

        const response = await get.indexer.indexTransaction(await tx1.buff, null)
        expect(response.enables).to.eql([tx2.txid])
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

    describe('when there is a failed dependency', () => {
      def('instance', async () => {
        const Counter = await get.Counter
        const instance = new Counter()
        await instance.sync()
        instance.inc()
        await instance.sync()
        return instance
      })

      beforeEach(async () => {
        const Counter = await get.Counter
        const instance = await get.instance
        const txid = txidFromLocation(Counter.location)
        const buff = Buffer.from(
          await get.run.blockchain.fetch(txid),
          'hex'
        )
        await get.indexer.trust(txid)
        await get.indexer.indexTransaction(buff, null)
        await get.indexer.indexTransaction(Buffer.from(
          await get.run.blockchain.fetch(txidFromLocation(instance.origin)), 'hex'
        ))
        await get.ds.setTransactionExecutionFailed(txidFromLocation(instance.origin))
      })

      it('marks the tx as failed', async () => {
        const instance = await get.instance
        const txid = txidFromLocation(instance.location)
        const buff = Buffer.from(
          await get.run.blockchain.fetch(txid),
          'hex'
        )

        await get.indexer.indexTransaction(buff, null)
        const tx = await get.ds.getTx(txid, () => expect.fail('should be present'))
        expect(tx.hasFailed()).to.eql(true)
      })

      it('returns a correct result', async () => {
        const instance = await get.instance
        const txid = txidFromLocation(instance.location)
        const buff = Buffer.from(
          await get.run.blockchain.fetch(txid),
          'hex'
        )

        const result = await get.indexer.indexTransaction(buff, null)
        expect(result.executed).to.eql(true)
        expect(result.success).to.eql(false)
      })

      it('returns an enablement if exists', async () => {
        const instance = await get.instance
        const txid = txidFromLocation(instance.location)
        const buff = Buffer.from(
          await get.run.blockchain.fetch(txid),
          'hex'
        )

        instance.inc()
        await instance.sync()

        const tipTxid = txidFromLocation(instance.location)
        const tipBuff = Buffer.from(
          await get.run.blockchain.fetch(tipTxid),
          'hex'
        )

        await get.indexer.indexTransaction(tipBuff, null)

        const result = await get.indexer.indexTransaction(buff, null)
        expect(result.enables).to.eql([tipTxid])
      })
    })
  })
})
