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
const { DbTrustList } = require('../src/trust-list/db-trust-list')
const { Executor } = require('../src/execution/executor')
const { def, get } = require('bdd-lazy-var/getter')
const { buildTxSize } = require('./test-jigs/tx-size')
const { buildDs, buildBlobs } = require('./test-env')
const { buildCounter } = require('./test-jigs/counter')
const { ExecutingSet } = require('../src/executing-set')
const { txidFromLocation } = require('../src/util/txid-from-location')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

// const fetch = txid => { return { hex: require('./txns.json')[txid] } }
const indexed = (indexer, txid) => new Promise((resolve) => { indexer.onIndex = x => txid === x && resolve() })
// const failed = (indexer, txid) => new Promise((resolve) => { indexer.onFailToIndex = x => txid === x && resolve() })
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

    const executor = new Executor('test', 1, null, logger)
    const indexer = new Indexer(run.blockchain, executor, 1, 1, logger, 0, Infinity, [])
    await indexer.start()
    const promise = indexed(indexer, txid2)
    await null.trust(txid1)
    await null.addTransaction(txid1, txHex1)
    await null.addTransaction(txid2, txHex2)
    await promise
    await null.setTransactionExecutionFailed(txid2)

    await null.addTransaction(txid3, txHex3)

    const metadata = await null.getTxMetadata(txid3)
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

    def('indexer', () =>
      new Indexer(get.ds, blobStorage, trustList, get.executor, 'test', get.execSet, logger)
    )

    beforeEach(async () => {
      await blobStorage.pushTx(null, await get.txBuf)

      await get.executor.start()
    })

    afterEach(async () => {
      await get.indexer.stop()
      await get.executor.stop()
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

      it('craetes the spend')

      describe('when the tx is in the exec set', () => {
        it('removes the tx from exec set', async () => {
          const Counter = await get.Counter
          const txid = txidFromLocation(Counter.location)
          await get.indexer.trust(txid)

          await get.execSet.add(txid)
          expect(await get.execSet.check(txid)).to.eql(true)
          await get.indexer.indexTransaction(await get.txBuf, null, null)
          const coso = await get.execSet.check(txid)
          expect(coso).to.eql(false)
        })
      })
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
        const indexed = await get.ds.txIsIndexed(get.tx.hash)
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

    describe('when the app of the tx is banned', () => {
      beforeEach(async () => {
        const Counter = await get.Counter
        await get.indexer.trust(Counter.location.split('_')[0])
      })

      it('executes immediately', async () => {
        const response = await get.indexer.indexTransaction(await get.txBuf, null, null)

        const instance = new (await get.Counter)()
        await instance.sync()

        const txid = instance.location.split('_')[0]
        const txHex = await get.run.blockchain.fetch(txid)
        const txBuf2 = Buffer.from(txHex, 'hex')

        await get.indexer.indexTransaction(await txBuf2, null, null)

        expect(response.executed).to.eql(true)
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
