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

  describe('#txidIsReadyToExecute', () => {
    it('returns false when tx does not exists', async () => {
      const result = await ds.txidIsReadyToExecute('doesnotexists')
      expect(result).to.eql(false)
    })

    it('returns true when tx exists and has no deps when tx does not exists', async () => {
      const txid = 'sometxid'
      await ds.addNewTx(txid, new Date().valueOf())
      await ds.setExecutableForTx(txid, 1)
      const result = await ds.txidIsReadyToExecute(txid)
      expect(result).to.eql(true)
    })

    it('returns false when tx exists has no dependencies but is not executable', async () => {
      const txid = 'sometxid'
      await ds.addNewTx(txid, new Date().valueOf())
      await ds.setExecutableForTx(txid, 0)
      const result = await ds.txidIsReadyToExecute(txid)
      expect(result).to.eql(false)
    })

    it('returns true when tx exists has has dependencies and the where executed ok', async () => {
      const dep = 'deptxid'
      const main = 'sometxid'

      await ds.addNewTx(dep, new Date().valueOf())
      await ds.addNewTx(main, new Date().valueOf())
      await ds.addDep(dep, main)

      await ds.setExecutableForTx(dep, 1)
      await ds.setExecutableForTx(dep, 1)

      await ds.setExecutableForTx(main, 1)

      const result = await ds.txidIsReadyToExecute(main)
      expect(result).to.eql(false)
    })

    it('returns false when tx exists has has a dependency but the dependency was not executed yet', async () => {
      const dep = 'deptxid'
      const main = 'sometxid'

      await ds.addNewTx(dep, new Date().valueOf())
      await ds.addNewTx(main, new Date().valueOf())
      await ds.addDep(dep, main)

      await ds.setExecutableForTx(dep, 1)
      await ds.setExecutableForTx(dep, 1)

      await ds.setExecutableForTx(main, 1)

      const result = await ds.txidIsReadyToExecute(main)
      expect(result).to.eql(false)
    })

    it('returns false when tx exists has has a dependency but the dependency failed on the execution', async () => {
      const dep = 'deptxid'
      const main = 'sometxid'

      await ds.addNewTx(dep, new Date().valueOf())
      await ds.addNewTx(main, new Date().valueOf())
      await ds.addDep(dep, main)

      // Mark as failed
      await ds.setExecutableForTx(dep, 0)
      await ds.setExecutedForTx(dep, 1)
      await ds.setIndexedForTx(dep, 0)

      await ds.setExecutableForTx(main, 1)

      const result = await ds.txidIsReadyToExecute(main)
      expect(result).to.eql(false)
    })

    it('returns true when tx exists and several has a dependencies all ok', async () => {
      const dep1 = 'deptxid1'
      const dep2 = 'deptxid2'
      const dep3 = 'deptxid3'
      const main = 'sometxid'

      await ds.addNewTx(dep1, new Date().valueOf())
      await ds.addNewTx(dep2, new Date().valueOf())
      await ds.addNewTx(dep3, new Date().valueOf())
      await ds.addNewTx(main, new Date().valueOf())
      await ds.addDep(dep1, main)
      await ds.addDep(dep2, main)
      await ds.addDep(dep3, main)

      // deps are ok
      await ds.setExecutableForTx(dep1, 1)
      await ds.setIndexedForTx(dep1, 1)
      await ds.setExecutableForTx(dep2, 1)
      await ds.setIndexedForTx(dep2, 1)
      await ds.setExecutableForTx(dep3, 1)
      await ds.setIndexedForTx(dep3, 1)

      await ds.setExecutableForTx(main, 1)

      const result = await ds.txidIsReadyToExecute(main)
      expect(result).to.eql(true)
    })

    it('returns false when tx exists and one was not indexed', async () => {
      const dep1 = 'deptxid1'
      const dep2 = 'deptxid2'
      const dep3 = 'deptxid3'
      const main = 'sometxid'

      await ds.addNewTx(dep1, new Date().valueOf())
      await ds.addNewTx(dep2, new Date().valueOf())
      await ds.addNewTx(dep3, new Date().valueOf())
      await ds.addNewTx(main, new Date().valueOf())
      await ds.addDep(dep1, main)
      await ds.addDep(dep2, main)
      await ds.addDep(dep3, main)

      // deps are ok
      await ds.setExecutableForTx(dep1, 1)
      await ds.setIndexedForTx(dep1, 1)
      await ds.setExecutableForTx(dep2, 1)
      await ds.setIndexedForTx(dep2, 1)
      await ds.setExecutableForTx(dep3, 1)
      await ds.setIndexedForTx(dep3, 0)

      await ds.setExecutableForTx(main, 1)

      const result = await ds.txidIsReadyToExecute(main)
      expect(result).to.eql(false)
    })

    it('returns false when tx exists and one failed', async () => {
      const dep1 = 'deptxid1'
      const dep2 = 'deptxid2'
      const dep3 = 'deptxid3'
      const main = 'sometxid'

      await ds.addNewTx(dep1, new Date().valueOf())
      await ds.addNewTx(dep2, new Date().valueOf())
      await ds.addNewTx(dep3, new Date().valueOf())
      await ds.addNewTx(main, new Date().valueOf())
      await ds.addDep(dep1, main)
      await ds.addDep(dep2, main)
      await ds.addDep(dep3, main)

      // deps are ok
      await ds.setExecutableForTx(dep1, 1)
      await ds.setIndexedForTx(dep1, 1)
      await ds.setExecutableForTx(dep2, 1)
      await ds.setIndexedForTx(dep2, 1)

      // one dep failed
      await ds.setExecutableForTx(dep3, 0)
      await ds.setExecutedForTx(dep3, 1)
      await ds.setIndexedForTx(dep3, 0)

      await ds.setExecutableForTx(main, 1)

      const result = await ds.txidIsReadyToExecute(main)
      expect(result).to.eql(false)
    })
  })
})
