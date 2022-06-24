module.exports = {
  client: 'pg',
  connection: process.env.BLOB_DB_CONNECTION_URI || {
    user: 'someuser',
    password: 'sosecret',
    database: 'blobs_regtest'
  },
  migrations: {
    tableName: 'migrations',
    directory: 'blobs-migrations'
  }
}
