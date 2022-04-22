const { nanoid } = require('nanoid')

class RabbitResponseQueue {
  constructor (channel, namePreffix) {
    this.channel = channel
    this.name = `${namePreffix}.${nanoid()}`
  }

  async setUp () {
    this.channel.assertQueue(this.name, { exclusive: true, durable: false, autoDelete: true })
  }

  async publishAndAwaitResponse (queue, event) {
    await queue.publish(event, { replyTo: this.id })
  }
}

module.exports = { RabbitResponseQueue }