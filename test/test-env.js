const knex = require('knex')
const { KnexDatasource } = require('../src/data-sources/knex-datasource')
const { KnexBlobStorage } = require('../src/data-sources/knex-blob-storage')
const { Executor } = require('../src/execution/executor')

const testLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

const buildDs = () => {
  const knexInstance = knex({
    client: 'sqlite3',
    connection: {
      filename: 'file:memDbMain?mode=memory&cache=shared',
      flags: ['OPEN_URI', 'OPEN_SHAREDCACHE']
    },
    migrations: {
      tableName: 'migrations',
      directory: 'db-migrations'
    },
    useNullAsDefault: true
  })

  return new KnexDatasource(knexInstance, testLogger, false)
}

const buildBlobs = () => {
  const blobsKnex = knex({
    client: 'sqlite3',
    connection: {
      filename: 'file:memDbBlobs?mode=memory&cache=shared',
      flags: ['OPEN_URI', 'OPEN_SHAREDCACHE']
    },
    migrations: {
      tableName: 'migrations',
      directory: 'blobs-migrations'
    },
    useNullAsDefault: true
  })

  return new KnexBlobStorage(blobsKnex, {
    serialize: JSON.stringify,
    deserialize: JSON.parse
  })
}

const buildExecutor = (network, blobs, ds, opts = { numWorkers: 1 }) => {
  return new Executor(network, opts.numWorkers, blobs, ds, testLogger, {})
}

module.exports = { buildDs, buildBlobs, buildExecutor, testLogger }
