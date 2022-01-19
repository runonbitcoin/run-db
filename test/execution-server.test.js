const { buildExecutionServer } = require('../src/execution/build-execution-server')
const { MemoryBlobStorage } = require('../src/data-sources/memory-blob-storage')
const txs = require('./txns.json')
const fetch = require('node-fetch')
const { expect } = require('chai')

const logger = {
  debug: () => {},
  info: () => {},
  log: () => {},
  warn: () => {},
  error: () => {}
}

describe('execution-server', () => {
  let bs
  let server

  beforeEach(async () => {
    bs = new MemoryBlobStorage()
    server = buildExecutionServer(logger, 1, bs, require.resolve('./test-worker.js'), 'test')
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
  })

  it('calls the worker', async () => {
    const txid = 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'
    await bs.pushTx(txid, Buffer.from(txs[txid], 'hex'))

    const response = await fetch(`http://localhost:${server.port}/execute`, {
      method: 'POST',
      body: JSON.stringify({
        txid, trustList: '*'
      })
    })

    expect(response.status).to.eql(200)
    const jsonResponse = await response.json()
    expect(jsonResponse.solution).to.eql(42)
  })
})
