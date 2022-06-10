const { expect } = require('chai')
const { WorkerThread } = require('../src/threading/worker-thread')

describe('SubThread', () => {
  it('executes in subthread', async () => {
    const worker = new WorkerThread(require.resolve('./test-workers/ping-pong.js'), {})
    await worker.setUp()
    const result = await worker.send('ping', {})
    expect(result).to.eql({ data: 'pong' })
    await worker.tearDown()
  })

  it('sends right worker data', async () => {
    const data = { a: Math.random(), b: Math.random() }
    const worker = new WorkerThread(require.resolve('./test-workers/worker-data.js'), data)
    await worker.setUp()
    const result = await worker.send('data', {})
    expect(result).to.eql(data)
    await worker.tearDown()
  })

  it('can send messages to parent process', async () => {
    const worker = new WorkerThread(require.resolve('./test-workers/send-to-parent.js'), {})
    await worker.setUp()
    const data = { data: Math.random() }
    await new Promise((resolve) => {
      worker.subscribe('sometopic', (msg) => {
        resolve()
        expect(msg).to.eql(data)
      })
      worker.send('send', { topic: 'sometopic', body: data })
    })
    await worker.tearDown()
  })

  it('can timeout', async () => {
    const worker = new WorkerThread(require.resolve('./test-workers/do-nothing.js'), {})
    await worker.setUp()
    await expect(worker.send('something', {}, { timeout: 10 })).to.eventually.be.rejectedWith('timeout')
    await worker.tearDown()
  })

  it('can timeout with general opts', async () => {
    const worker = new WorkerThread(require.resolve('./test-workers/do-nothing.js'), {}, { timeout: 10 })
    await worker.setUp()
    await expect(worker.send('something', {})).to.eventually.be.rejectedWith('timeout')
    await worker.tearDown()
  })
})
