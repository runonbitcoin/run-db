const { EventQueue } = require('./exec-queue')
const _ = require('lodash')
const { MemoryResponseQueue } = require('./memory-response-queue')
const { nanoid } = require('nanoid')

class MemorySubscription {
  constructor (queue, fn) {
    this.queue = queue
    this.fn = fn
  }

  async cancel () {
    this.queue.subscriptions = this.queue.subscriptions.filter(fn => fn !== this.fn)
  }
}

class MemoryQueue extends EventQueue {
  constructor () {
    super()
    this.pending = []
    this.subscriptions = []
    this.current = Promise.resolve()
    this._onEmpty = () => {}
    this.replyQueues = new Map()
  }

  async publish (event, opts = {}) {
    this.pending.push(event)
    this.current = this.current.then(() => {
      return Promise.all(this.subscriptions.map(
        async s => {
          const result = await s(event, opts)
          if (opts.replyTo) {
            await this.replyQueues.get(opts.replyTo).publish(result, { correlationId: opts.messageId })
          }
        }
      ))
    }).then(() => {
      _.remove(this.pending, e => e === event)
      if (this.pending.length === 0) {
        this._onEmpty()
      }
    })
  }

  async getReplyQueue () {
    const name = nanoid()
    const replyQueue = new MemoryResponseQueue(this, name, this.constructor)
    await replyQueue.setUp()
    this.replyQueues.set(name, replyQueue)
    return replyQueue
  }

  async subscribe (fn) {
    this.subscriptions.push(fn)
    return new MemorySubscription(this, fn)
  }

  // non interface

  async onEmpty (fn) {
    this._onEmpty = fn
  }
}

module.exports = { MemoryQueue }
