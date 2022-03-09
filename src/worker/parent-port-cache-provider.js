const { CacheProvider } = require('./cache-provider')
const { ParentPortCache } = require('./parent-port-cache')

class ParentPortCacheProvider extends CacheProvider {
  async setUp () {}

  async tearDown () {}

  async get () {
    return new ParentPortCache()
  }
}

module.exports = ParentPortCacheProvider
