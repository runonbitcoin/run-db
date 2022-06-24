const { MemoryQueue } = require('../src/queues/memory-queu')
const { expect } = require('chai')
const { Clock } = require('../src')

describe('MemoryQueue', () => {
  it('can queue a job', async () => {
    const queue = new MemoryQueue()
    const anEvent = { value: Math.random() }
    const promise = new Promise(resolve => {
      queue.onEmpty(resolve)
    })

    let calls = 0
    await queue.subscribe(async (event) => {
      expect(event).to.deep.equal(anEvent)
      calls += 1
    })
    await queue.publish(anEvent)
    await promise
    expect(calls).to.eql(1)
  })

  it('when multiple events perform in right order.', async () => {
    const queue = new MemoryQueue()
    const events = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ n }))
    const promise = new Promise(resolve => {
      queue.onEmpty(resolve)
    })

    const calls = []
    await queue.subscribe(async (event) => {
      calls.push(event)
    })
    for (const e of events) {
      await queue.publish(e)
    }
    await promise
    expect(calls).to.deep.eql(events)
  })

  it('when multiple events with async handler perform in right order.', async () => {
    const queue = new MemoryQueue()
    const events = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ n }))
    const clock = new Clock()

    const calls = []
    await queue.subscribe(async (event) => {
      const task = clock.delay(() => {}, 100)
      await task
      calls.push(event)
    })

    const promise = new Promise(resolve => {
      queue.onEmpty(resolve)
    })

    for (const e of events) {
      await queue.publish(e)
    }

    await promise
    expect(calls).to.deep.eql(events)
  })

  describe('publish with responses', () => {
    it('sends the response', async () => {
      const queue = new MemoryQueue()
      await queue.setUp()
      const replyQueue = await queue.getReplyQueue()

      queue.subscribe((a) => a)
      const value = { value: Math.random() }
      const response = await replyQueue.publishAndAwaitResponse(value)
      expect(response).to.eql(value)
    })
  })
})
