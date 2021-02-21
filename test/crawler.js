/**
 * crawler.js
 *
 * Tests for the crawler and APIs it uses
 */

const { describe, it } = require('mocha')
const { expect } = require('chai')
const Indexer = require('../src/indexer')
const txns = require('./txns.json')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const fetch = txid => require('./txns.json')[txid]
const indexed = (indexer, txid) => new Promise((resolve, reject) => { indexer.onIndex = x => txid === x && resolve() })

// ------------------------------------------------------------------------------------------------
// Crawler
// ------------------------------------------------------------------------------------------------

describe('Crawler', () => {
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

  it.skip('reorg', async () => {
    // TODO
  })
})

// ------------------------------------------------------------------------------------------------
