const Run = require('run-sdk')

const buildContainer = () => {
  class Container extends Run.Jig {
    init (aThing) {
      this.thing = aThing
    }
  }

  return Container
}

module.exports = { buildContainer }
