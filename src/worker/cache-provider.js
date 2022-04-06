class CacheProvider {
  constructor (logger, opts = {}) {
    this.logger = logger
    this.opts = opts
  }

  async setUp () {}

  async tearDown () {}

  async get () {
    throw new Error('subclass responsibility')
  }
}

module.exports = { CacheProvider }
