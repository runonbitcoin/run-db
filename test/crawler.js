/**
 * crawler.js
 *
 * Tests for the crawler and APIs it uses
 */

const { describe } = require('mocha')
// const { expect } = require('chai')
// const Indexer = require('../src/indexer')
// const txns = require('./txns.json')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

// const fetch = txid => require('./txns.json')[txid]
// const indexed = (indexer, txid) => new Promise((resolve, reject) => { indexer.onIndex = x => txid === x && resolve() })
// const crawled = (indexer) => new Promise((resolve, reject) => { indexer.onBlock = height => resolve(height) })
// const reorged = (indexer) => new Promise((resolve, reject) => { indexer.onReorg = newHeight => resolve(newHeight) })

// ------------------------------------------------------------------------------------------------
// Crawler
// ------------------------------------------------------------------------------------------------

describe('Crawler', () => {
  /*
  it('add txids', async () => {
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    function getNextBlock (height, hash) {
      return { height: 1, hash: 'abc', txids: [txid] }
    }
    const api = { getNextBlock, fetch }
    const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0)
    await indexer.start()
    await indexed(indexer, txid)
    expect(indexer.status().height).to.equal(1)
    expect(indexer.status().hash).to.equal('abc')
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('add block', async () => {
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    function getNextBlock (height, hash) {
      return { height: 1, hash: 'abc', txids: [txid], txhexs: [txns[txid]] }
    }
    const api = { getNextBlock }
    const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0)
    await indexer.start()
    await indexed(indexer, txid)
    expect(indexer.status().height).to.equal(1)
    expect(indexer.status().hash).to.equal('abc')
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('reorg blocks', async () => {
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    let didReorg = false
    let didIndex = false
    function getNextBlock (height, hash) {
      if (didReorg) return { height: 3, hash: 'def', txids: [] }
      if (height < 5) return { height: height + 1, hash: 'abc' + height, txids: [] }
      if (height === 5) return { height: height + 1, hash: 'abc', txids: [txid] }
      if (height < 12) return { height: height + 1, hash: 'abc' + height, txids: [] }
      if (!didIndex) { return null }
      if (height === 12) { didReorg = true; return { reorg: true } }
    }
    const api = { getNextBlock, fetch }
    const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0)
    indexer.crawler.pollForNewBlocksInterval = 10
    await indexer.start()
    await indexed(indexer, txid)
    didIndex = true
    await reorged(indexer)
    expect(indexer.database.getHeight()).to.equal(2)
    await crawled(indexer, 3)
    expect(indexer.status().height).to.equal(3)
    expect(indexer.status().hash).to.equal('def')
    expect(await indexer.tx(txid)).to.equal(undefined)
    expect(await indexer.jig(txid + '_o1')).to.equal(undefined)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('reorg while executing', async () => {
    const txid = '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64'
    let didReorg = false
    function getNextBlock (height, hash) {
      if (didReorg) return { height: 3, hash: 'def', txids: [] }
      if (height < 5) return { height: height + 1, hash: 'abc' + height, txids: [] }
      if (height === 5) return { height: height + 1, hash: 'abc', txids: [txid] }
      if (height < 12) return { height: height + 1, hash: 'abc' + height, txids: [] }
      if (height === 12) { didReorg = true; return { reorg: true } }
    }
    const api = { getNextBlock, fetch }
    const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0)
    await indexer.start()
    await reorged(indexer)
    expect(await indexer.tx(txid)).to.equal(undefined)
    expect(await indexer.jig(txid + '_o1')).to.equal(undefined)
    await indexer.stop()
  })
  */
})

// ------------------------------------------------------------------------------------------------
