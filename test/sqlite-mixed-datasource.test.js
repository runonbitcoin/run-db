const { SqliteMixedDatasource } = require('../src/data-sources/sqlite-mixed-datasource')
const { MemoryBlobStorage } = require('../src/data-sources/memory-blob-storage')
const { expect } = require('chai')
const txns = require('./txns.json')

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

describe('SqliteMixedDataSource', () => {
  let blobStorage = null
  let ds

  beforeEach(async () => {
    blobStorage = new MemoryBlobStorage()
    ds = new SqliteMixedDatasource(':memory:', logger, false, blobStorage)
    await ds.setUp()
  })

  describe('tx management', () => {
    it('returns null for a tx that is not in the blob storage', async () => {
      const result = await ds.getTxHex('doesnotexists')
      expect(result).to.eql(null)
    })

    it('returns a tx that was defined in the storage', async () => {
      const txid = 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'
      const txHex = txns[txid]
      blobStorage.pushTx(txid, Buffer.from(txHex, 'hex'))

      const result = await ds.getTxHex(txid)
      expect(result).to.eql(txHex)
    })

    it('does not send the tx hex when registering the tx', async () => {
      const txid = 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'
      const txHex = txns[txid]
      await ds.setTxBytes(txid, Buffer.from(txHex, 'hex'))
      expect(await blobStorage.pullTx(txid, () => null)).to.eql(null)
    })
  })

  describe('state management', () => {
    it('returns null for a state that is not in the blob storage', async () => {
      const result = await ds.getJigState('doesNotExists')
      expect(result).to.eql(null)
    })

    it('returns a state that is present in the blob storage.', async () => {
      const location = 'someLocation'
      await blobStorage.pushJigState(location, { state: true })
      const result = await ds.getJigState(location)
      expect(result).to.eql({ state: true })
    })

    it('returns a berry state that is present in the blob storage.', async () => {
      const location = 'someLocation'
      await blobStorage.pushJigState(location, { state: true })
      const result = await ds.getBerryState(location)
      expect(result).to.eql({ state: true })
    })

    it('does not push the state on the publishing', async () => {
      const location = 'somelocation'
      const state = { state: true }
      await ds.setJigState(location, state)
      expect(await blobStorage.pullJigState(location, () => null)).to.eql(null)
    })

    it('does not push berry state on set', async () => {
      const location = 'somelocation'
      const state = { state: true }
      await ds.setBerryState(location, state)
      expect(await blobStorage.pullJigState(location, () => null)).to.eql(null)
    })
  })
})
