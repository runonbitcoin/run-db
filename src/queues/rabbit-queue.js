const { EventQueue } = require('./exec-queue')
const { nanoid } = require('nanoid')
const { RabbitResponseQueue } = require('./rabbit-response-queue')

class RabbitSubscription {
  constructor (channel, consumerTag) {
    this.channel = channel
    this.consumerTag = consumerTag
  }

  async cancel () {
    await this.channel.cancel(this.consumerTag)
    this.channel.subscriptions = this.channel.subscriptions.filter(tag => tag !== this.consumerTag)
  }
}

class RabbitQueue extends EventQueue {
  constructor (channel, name, extraOpts = {}) {
    super()
    this.channel = channel
    this.name = name
    this.subscriptions = []
    this.extraOpts = extraOpts
  }

  async setUp () {
    await this.channel.assertExchange(this.name, 'fanout', {
      durable: this.extraOpts.durable || true,
      exclusive: this.extraOpts.exclusive || false
    })
    await this.channel.assertQueue(this.name, {
      durable: this.extraOpts.durable || true,
      exclusive: this.extraOpts.exclusive || false
    })
    await this.channel.bindQueue(this.name, this.name, '')
  }

  async tearDown () {
    for (const sub in this.subscriptions) {
      await sub.cancel()
    }
  }

  async publish (event, opts = {}) {
    await this.channel.publish(this.name, '', Buffer.from(JSON.stringify(event)), opts)
  }

  async getReplyQueue () {
    const name = `${this.name}.reply.${nanoid()}`
    const replyQueue = new RabbitResponseQueue(this, name, this.constructor)
    await replyQueue.setUp()
    return replyQueue
  }

  async subscribe (fn) {
    const { consumerTag } = await this.channel.consume(this.name, async (event) => {
      const payload = JSON.parse(event.content)
      try {
        const response = await fn(payload)
        if (event.properties.replyTo) {
          this.channel.sendToQueue(event.properties.replyTo, Buffer.from(response ? JSON.stringify(response) : ''), {
            persistent: false,
            correlationId: event.properties.messageId
          })
        }
        await this.channel.ack(event)
      } catch (e) {
        await this.channel.nack(event)
      }
    })
    const rabbitSubscription = new RabbitSubscription(this.channel, consumerTag)
    this.subscriptions.push(rabbitSubscription)
    return rabbitSubscription
  }
}

module.exports = { RabbitQueue }
