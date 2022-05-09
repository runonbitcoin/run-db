const { nanoid } = require('nanoid')

class RabbitResponseQueue {
  constructor (parentQueue, name, _constructor) {
    this.parentQueue = parentQueue
    this.channel = this.parentQueue.channel
    this.queueName = name
    this.pending = new Map()
  }

  async setUp () {
    await this.channel.assertQueue(this.queueName, { durable: false, exclusive: true, autoDelete: true })
    await this.channel.consume(this.queueName, async (event) => {
      const payload = JSON.parse(event.content)
      const correlationId = event.properties.correlationId
      await this._onEvent(payload, correlationId)
      await this.channel.ack(event)
    })
  }

  async publishAndAwaitResponse (event) {
    return new Promise(resolve => {
      const messageId = nanoid()
      this.pending.set(messageId, resolve)
      return this.parentQueue.publish(event, { replyTo: this.queueName, messageId })
    })
  }

  async _onEvent (rawEvent, correlationId) {
    this.pending.get(correlationId)(rawEvent)
  }
}

module.exports = { RabbitResponseQueue }
