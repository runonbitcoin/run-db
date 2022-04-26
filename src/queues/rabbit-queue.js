const { EventQueue } = require('./exec-queue')

class RabbitQueue extends EventQueue {
  constructor (channel, name) {
    super()
    this.channel = channel
    this.name = name
    this.subscriptions = []
  }

  async setUp () {
    await this.channel.assertExchange(this.name, 'fanout', {
      durable: true
    })
    await this.channel.assertQueue(this.name, { durable: true })
    await this.channel.bindQueue(this.name, this.name, '')
  }

  async tearDown () {
    for (const tag in this.subscriptions) {
      await this.channel.cancel(tag)
    }
  }

  async publish (event, opts = {}) {
    await this.channel.publish(this.name, '', Buffer.from(JSON.stringify(event)), opts)
  }

  async publishWithResponse (event, responseQueue) {
    // await this.channel.publish(this.name, '', Buffer.from(JSON.stringify(event)), { persistent: true, replyTo: opts.replyTo.name })
    responseQueue.publishAndAwaitResponse(this, event)
  }

  async subscribe (fn) {
    const { consumerTag } = await this.channel.consume(this.name, async (event) => {
      const payload = JSON.parse(event.content)
      try {
        const response = await fn(payload)
        if (event.replyTo) {
          this.channel.sendToQueue(event.replyTo, Buffer.from(JSON.stringify(response)), { persistent: false, correlationId: event.messageId })
        }
        await this.channel.ack(event)
      } catch (e) {
        await this.channel.nack(event)
      }
    })
    this.subscriptions.push(consumerTag)
  }
}

module.exports = { RabbitQueue }
