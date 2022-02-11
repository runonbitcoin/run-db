class CacheProvider {
  constructor (blobStorage, logger, opts) {
    this.blob = blobStorage
    this.logger = logger
    this.opts = opts
  }

  async setUp () {
    throw new Error('subclass responsibility')
  }

  async get () {
    throw new Error('subclass responsibility')
  }

  async tearDown () {
    throw new Error('subclass responsibility')
  }
}

module.exports = { CacheProvider }
