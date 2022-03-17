module.exports = {
  client: 'pg',
  connection: process.env.DB_CONNECTION_URI || {
    user: 'someuser',
    password: 'sosecret',
    database: 'rundb_regtest'
  },
  migrations: {
    tableName: 'migrations',
    directory: 'blobs-migrations'
  }
}
