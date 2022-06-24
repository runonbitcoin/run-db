const { instance } = require('../threading/parent-process')

class ParentPortCache {
  constructor () {
    this.state = {}
    this.newStates = {}
  }

  async get (key) {
    if (key in this.state) {
      return this.state[key]
    }

    return await instance.send('cacheGet', { key })
  }

  async set (key, value) {
    this.state[key] = value
    if (key.startsWith('jig://') || key.startsWith('berry://')) {
      this.newStates[key] = value
    }
  }
}

module.exports = { ParentPortCache }
