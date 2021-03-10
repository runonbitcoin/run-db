/**
 * indexer.js
 *
 * Tests for the Indexer
 */

const { describe, it } = require('mocha')
const { expect } = require('chai')
const Indexer = require('../src/indexer')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const fetch = txid => { return { hex: require('./txns.json')[txid] } }
const api = { fetch }
const indexed = (indexer, txid) => new Promise((resolve, reject) => { indexer.onIndex = x => txid === x && resolve() })
const failed = (indexer, txid) => new Promise((resolve, reject) => { indexer.onFailToIndex = x => txid === x && resolve() })

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

describe('Indexer', () => {
  it('add and index', async () => {
    const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0, Infinity)
    await indexer.start()
    indexer.add('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64')
    indexer.add('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('add in reverse and index', async () => {
    const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0, Infinity)
    await indexer.start()
    indexer.add('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    indexer.add('3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64')
    await indexed(indexer, '9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('fail to index', async () => {
    const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0, Infinity)
    await indexer.start()
    indexer.trust('b17a9af70ab0f46809f908b2e900e395ba40996000bf4f00e3b27a1e93280cf1')
    indexer.trust('a5291157ab7a2d80d834bbe82c380ce3976f53990d20c62c477ca3a2ac93a7e9')
    indexer.add('b17a9af70ab0f46809f908b2e900e395ba40996000bf4f00e3b27a1e93280cf1')
    indexer.add('a5291157ab7a2d80d834bbe82c380ce3976f53990d20c62c477ca3a2ac93a7e9')
    await failed(indexer, 'a5291157ab7a2d80d834bbe82c380ce3976f53990d20c62c477ca3a2ac93a7e9')
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('discovered berry transaction', async () => {
    const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0, Infinity)
    await indexer.start()
    indexer.add('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d') // Class with berry image
    indexer.add('24cde3638a444c8ad397536127833878ffdfe1b04d5595489bd294e50d77105a') // B (old)
    indexer.add('312985bd960ae4c59856b3089b04017ede66506ea181333eec7c9bb88b11c490') // txo, Tx
    indexer.add('727e7b423b7ee40c0b5be87fba7fa5673ea2d20a74259040a7295d9c32a90011') // Hex
    // Don't index the berry data, because it will be fetched automatically
    // indexer.add('2f3492ef5401d887a93ca09820dff952f355431cea306841a70d163e32b2acad') // Berry data
    await indexed(indexer, 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('add and download dependencies', async () => {
    const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0, Infinity)
    await indexer.start()
    indexer.add('9bb02c2f34817fec181dcf3f8f7556232d3fac9ef76660326f0583d57bf0d102')
    await new Promise((resolve, reject) => setTimeout(resolve, 1000))
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('remove discovered dep', async () => {
    const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0, Infinity)
    await indexer.start()
    indexer.add('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d') // Class with berry image
    await indexed(indexer, 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')
    expect(await indexer.tx('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')).not.to.equal(undefined)
    indexer.remove('2f3492ef5401d887a93ca09820dff952f355431cea306841a70d163e32b2acad') // Berry data
    expect(await indexer.tx('bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d')).to.equal(undefined)
    await indexer.stop()
  })

  // --------------------------------------------------------------------------

  it('get spent', async () => {
    const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0, Infinity)
    await indexer.start()
    indexer.add('11f27cdad53128a4eb14c8328515dfab56b16ea5a71dd26abe9e9d7488f3ab83')
    await indexed(indexer, '11f27cdad53128a4eb14c8328515dfab56b16ea5a71dd26abe9e9d7488f3ab83')
    expect(indexer.spends('7fa1b0eb8408047e138aadf72ee0980e42afab2208181429b050ad495a384d39_o1'))
      .to.equal('11f27cdad53128a4eb14c8328515dfab56b16ea5a71dd26abe9e9d7488f3ab83')
    expect(indexer.spends('11f27cdad53128a4eb14c8328515dfab56b16ea5a71dd26abe9e9d7488f3ab83_o1'))
      .to.equal(null)
    await indexer.stop()
  }).timeout(40000)

  // --------------------------------------------------------------------------

  it('get untrusted of missing transaction', async () => {
    const indexer = new Indexer(':memory:', api, 'main', 1, 1, null, 0, Infinity)
    await indexer.start()
    expect((await indexer.untrusted('0000000000000000000000000000000000000000000000000000000000000000')).length).to.equal(0)
    await indexer.stop()
  })
})

// ------------------------------------------------------------------------------------------------
