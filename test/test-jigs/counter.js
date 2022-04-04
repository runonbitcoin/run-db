const Run = require('run-sdk')

const buildCounter = () => {
  class Counter extends Run.Jig {
    init () {
      this.count = 0
    }

    inc () {
      this.count = this.count + 1
    }
  }

  return Counter
}

module.exports = { buildCounter }
