const { expect } = require('chai')
const { WorkerThread } = require('../src/threading/worker-thread')

describe('SubThread', () => {
  it('executes in subthread', async () => {
    const worker = new WorkerThread(require.resolve('./test-workers/ping-pong.js'), {})
    await worker.setUp()
    const result = await worker.port.send('ping', {})
    expect(result).to.eql({ data: 'pong' })
  })

  it('sends right worker data', async () => {
    const data = { a: Math.random(), b: Math.random() }
    const worker = new WorkerThread(require.resolve('./test-workers/worker-data.js'), data)
    await worker.setUp()
    const result = await worker.port.send('data', {})
    expect(result).to.eql(data)
  })

  it('can send messages to parent process', async () => {

  })
})
