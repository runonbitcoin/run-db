const { KnexBlobStorage } = require('../src/data-sources/knex-blob-storage')
const { def, get } = require('bdd-lazy-var/getter')
const { expect } = require('chai')
const knex = require('knex')

describe('KnexBlobStorage', () => {
  def('knex', () => knex({
    client: 'better-sqlite3',
    connection: {
      filename: ':memory:'
    },
    migrations: {
      tableName: 'migrations',
      directory: 'blobs-migrations'
    },
    useNullAsDefault: true
  }))

  beforeEach(async () => {
    await get.knex.migrate.latest()
  })

  afterEach(async () => {
    await get.knex.destroy()
  })

  def('filter', () => ({
    serialize: JSON.stringify,
    deserialize: JSON.parse
  }))

  def('blobs', () => new KnexBlobStorage(get.knex, get.filter))

  describe('txs', () => {
    it('returns a previously stored tx', async () => {
      const someTxid = 'sometxid'
      const txContent = Buffer.from('sometx')
      await get.blobs.pushTx(someTxid, txContent)
      const retrievedBlob = await get.blobs.pullTx(someTxid)
      expect(Buffer.compare(retrievedBlob, txContent)).to.eql(0)
    })

    it('executes ifNone when tx is not present', async () => {
      const someTxid = 'sometxid'
      const token = {}
      const response = await get.blobs.pullTx(someTxid, () => token)

      expect(response).to.eql(token)
    })

    it('calculates txid when not sent', async () => {
      const txid = 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'
      const txHex = require('./txns.json')[txid]
      const rawTx = Buffer.from(txHex, 'hex')
      await get.blobs.pushTx(null, rawTx)
      const response = await get.blobs.pullTx(txid, () => expect.fail('tx is present'))

      expect(Buffer.compare(response, rawTx)).to.eql(0)
    })

    it('returns the tx when pushed', async () => {
      const txid = 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'
      const txHex = require('./txns.json')[txid]
      const rawTx = Buffer.from(txHex, 'hex')
      const pushResponse = await get.blobs.pushTx(null, rawTx)

      expect(pushResponse).to.eql(txid)
    })

    it('when txid is provided used provided txid', async () => {
      const realTxid = 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'
      const txHex = require('./txns.json')[realTxid]
      const wrongTxid = 'wrongTxid'
      const rawTx = Buffer.from(txHex, 'hex')
      const pushResponse = await get.blobs.pushTx(wrongTxid, rawTx)
      const pullResponse = await get.blobs.pullTx(wrongTxid, () => expect.fail('shold be present'))

      expect(pushResponse).to.eql(wrongTxid)
      expect(Buffer.compare(pullResponse, rawTx)).to.eql(0)
    })

    it('throws and error when pushing null tx', async () => {
      await expect(get.blobs.pushTx(null)).to.be.rejectedWith(Error, 'missing rawtx')
    })
  })

  describe('state', () => {
    it('can retrieve a saved state', async () => {
      const location = 'someLocation'
      const state = { some: 'state' }
      await get.blobs.pushJigState(location, state)
      const retrievedState = await get.blobs.pullJigState(location)
      expect(retrievedState).to.deep.equal(state)
    })

    it('executes ifNone when state not present', async () => {
      const location = 'someLocation'
      const token = {}
      const retrievedState = await get.blobs.pullJigState(location, () => token)
      expect(retrievedState).to.eq(token)
    })

    it('replaces state pushed twice', async () => {
      const location = 'someLocation'
      const state1 = { first: 'first' }
      const state2 = { second: 'second' }
      await get.blobs.pushJigState(location, state1)
      await get.blobs.pushJigState(location, state2)
      const retrievedState = await get.blobs.pullJigState(location, () => expect.fail('should be present'))
      expect(retrievedState).to.deep.eq(state2)
    })

    it('fails if location is not present', async () => {
      const state = { state: 'state' }
      await expect(get.blobs.pushJigState(null, state)).to.be.rejectedWith(Error, 'missing location')
    })

    it('fails if state is not present', async () => {
      const location = 'someLocation'
      await expect(get.blobs.pushJigState(location, null)).to.be.rejectedWith(Error, 'missing state')
    })
  })
})
