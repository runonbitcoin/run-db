const { nanoid } = require('nanoid')

class MemoryResponseQueue {
  constructor (parentQueue, name, Constructor) {
    this.parentQueue = parentQueue
    this.queue = new Constructor()
    this.name = name
    this.pending = new Map()
  }

  async setUp () {
    await this.queue.subscribe(this._onEvent.bind(this))
  }

  async publish (event, opts) {
    this.queue.publish(event, opts)
  }

  // async subscribe (subscribe) {
  //   this.queue.publish(subscribe, opts)
  // }

  async publishAndAwaitResponse (event) {
    return new Promise(resolve => {
      const messageId = nanoid()
      this.pending.set(messageId, resolve)
      return this.parentQueue.publish(event, { replyTo: this.name, messageId })
    })
  }

  async _onEvent (rawEvent, headers) {
    const { correlationId } = headers
    this.pending.get(correlationId)(rawEvent)
  }
}

module.exports = { MemoryResponseQueue }
