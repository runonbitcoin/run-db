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

async function fetchExecution (server, txid, params) {
  return await fetch(`http://localhost:${server.port}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  })
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

    const response = await fetchExecution(server, txid, { txid, trustList: ['*'] })

    expect(response.status).to.eql(200)
    const jsonResponse = await response.json()
    expect(jsonResponse.solution).to.eql(42)
  })

  it('sends the right parameters to the worker', async () => {
    const txid = 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'
    const txHex = txs[txid]
    await bs.pushTx(txid, Buffer.from(txHex, 'hex'))

    const response = await fetchExecution(server, txid, { txid, trustList: ['*'] })

    const jsonResponse = await response.json()
    expect(jsonResponse.params).to.have.length(3)
    expect(jsonResponse.params[0]).to.eql(txid)
    expect(jsonResponse.params[1]).to.eql(txHex)
    expect(jsonResponse.params[2]).to.eql(['*'])
  })

  it('returns 400 when trustlist is not a list', async () => {
    const txid = 'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d'

    const response = await fetchExecution(server, txid, { txid, trustList: '*' })
    expect(response.status).to.eql(400)
    const jsonResponse = await response.json()
    expect(jsonResponse.code).to.eql('wrong-arguments')
    expect(jsonResponse.message).to.eql('wrong parameter: trustList')
    expect(jsonResponse.data).to.eql({ trustList: '*' })
  })

  it('returns 400 when txid is not a txid', async () => {
    const txid = 'notatxid'

    const response = await fetchExecution(server, txid, { txid, trustList: ['*'] })
    expect(response.status).to.eql(400)
    const jsonResponse = await response.json()
    expect(jsonResponse.code).to.eql('wrong-arguments')
    expect(jsonResponse.message).to.eql('wrong parameter: txid')
    expect(jsonResponse.data).to.eql({ txid })
  })
})
