/**
 * background-loader.js
 *
 * Loads initial transactions to execute in the background which may take a while
 */

const { parentPort, workerData } = require('worker_threads')
const Sqlite3Database = require('better-sqlite3')

if (workerData.dbPath !== ':memory:') {
  console.log('Loading transactions to execute')

  const db = new Sqlite3Database(workerData.dbPath)

  // 100MB cache
  db.pragma('cache_size = 6400')
  db.pragma('page_size = 16384')

  const getReadyToExecuteStmt = db.prepare(`
      SELECT txid
      FROM tx 
      WHERE bytes IS NOT NULL
      AND executable = 1
      AND executed = 0
      AND (has_code = 0 OR (SELECT COUNT(*) FROM trust WHERE trust.txid = tx.txid AND trust.value = 1) = 1)
      AND txid NOT IN ban
      AND txid NOT IN (
          SELECT deps.down
          FROM deps
          JOIN tx AS tx2
          ON deps.up = tx2.txid
          WHERE ((tx2.bytes IS NULL) OR (tx2.executable = 1 AND tx2.executed = 0))
      )
  `)

  for (const row of getReadyToExecuteStmt.raw(true).iterate()) {
    parentPort.postMessage(row[0])
  }
}
