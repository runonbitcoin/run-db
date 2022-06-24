const { CacheProvider } = require('./cache-provider')
const { DirectCache } = require('./direct-cache')
const knex = require('knex')
const { KnexBlobStorage } = require('../data-sources/knex-blob-storage')

class KnexCacheProvider extends CacheProvider {
  constructor (logger, opts) {
    super(logger, opts)
    const knexConfig = process.env.KNEX_CONFIG
      ? JSON.parse(process.env.KNEX_CONFIG)
      : {
          client: process.env.BLOB_DB_CLIENT || 'pg',
          connection: process.env.BLOB_DB_CONNECTION_URI,
          migrations: {
            tableName: 'migrations',
            directory: 'blobs-migrations'
          },
          pool: {
            min: 1,
            max: 10
          },
          useNullAsDefault: true
        }
    this.knex = knex(knexConfig)
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
