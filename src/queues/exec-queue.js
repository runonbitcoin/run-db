class EventQueue {
  setUp () {}
  tearDown () {}

  async publish (_event) {
    throw new Error('subclass responsibility')
  }

  async subscribe (_fn) {
    throw new Error('subclass responsibility')
  }
}

module.exports = { EventQueue }
