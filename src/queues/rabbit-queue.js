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

  async publish (event) {
    await this.channel.publish(this.name, '', Buffer.from(JSON.stringify(event)), { persistent: true })
  }

  async subscribe (fn) {
    const { consumerTag } = await this.channel.consume(this.name, async (event) => {
      const payload = JSON.parse(event.content)
      try {
        await fn(payload)
        await this.channel.ack(event)
      } catch (e) {
        await this.channel.nack(event)
      }
    })
    this.subscriptions.push(consumerTag)
  }
}

module.exports = { RabbitQueue }
