const { nanoid } = require('nanoid')

class RabbitResponseQueue {
  constructor (parentQueue, name, Constructor) {
    this.parentQueue = parentQueue
    this.name = name
    this.queue = new Constructor(parentQueue.channel, this.name)
    this.pending = new Map()
  }

  async setUp () {
    await this.queue.set()
    await this.queue.subscribe(this._onEvent.bind(this))
  }

  async publish (event, opts) {
    this.queue.publish(event, opts)
  }

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

module.exports = { RabbitResponseQueue }