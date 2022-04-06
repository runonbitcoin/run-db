const { CacheProvider } = require('./cache-provider')
const { DirectCache } = require('./direct-cache')
const knex = require('knex')
const { KnexBlobStorage } = require('../data-sources/knex-blob-storage')

class KnexCacheProvider extends CacheProvider {
  constructor (logger, opts) {
    super(logger, opts)
    this.knex = knex(JSON.parse(process.env.KNEX_CONFIG))
    const filter = process.env.FILTER_PATH
      ? require(process.env.FILTER_PATH)
      : KnexBlobStorage.defaultFilter
    this.blobs = new KnexBlobStorage(this.knex, filter)
  }

  async setUp () {
    await this.blobs.setUp()
  }

  async tearDown () {
    await this.blobs.tearDown()
  }

  async get () {
    return new DirectCache(this.blobs, this.logger)
  }
}

module.exports = KnexCacheProvider
