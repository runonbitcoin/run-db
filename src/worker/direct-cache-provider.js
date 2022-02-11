const { CacheProvider } = require('./cache-provider')
const { DirectCache } = require('./direct-cache')

class ParentPortCacheProvider extends CacheProvider {
  async setUp () {}

  async tearDown () {}

  async get () {
    return new DirectCache(this.blob, this.logger)
  }
}

module.exports = ParentPortCacheProvider
