/**
 * database.js
 *
 * Layer between the database and the application
 */
const { HEIGHT_MEMPOOL } = require('../constants')
const knex = require('knex')
const { TX, DEPS, EXECUTING, TRUST } = require('./columns')

this.addNewTransactionStmt = this.connection.prepare('INSERT OR IGNORE INTO tx (txid, height, time, bytes, has_code, executable, executed, indexed) VALUES (?, null, ?, null, 0, 0, 0, 0)')
// this.setTransactionBytesStmt = this.connection.prepare('UPDATE tx SET bytes = ? WHERE txid = ?')
// this.setTransactionExecutableStmt = this.connection.prepare('UPDATE tx SET executable = ? WHERE txid = ?')
// this.setTransactionTimeStmt = this.connection.prepare('UPDATE tx SET time = ? WHERE txid = ?')
// this.setTransactionHeightStmt = this.connection.prepare(`UPDATE tx SET height = ? WHERE txid = ? AND (height IS NULL OR height = ${HEIGHT_MEMPOOL})`)
// this.setTransactionHasCodeStmt = this.connection.prepare('UPDATE tx SET has_code = ? WHERE txid = ?')
// this.setTransactionExecutedStmt = this.connection.prepare('UPDATE tx SET executed = ? WHERE txid = ?')
// this.setTransactionIndexedStmt = this.connection.prepare('UPDATE tx SET indexed = ? WHERE txid = ?')
// this.txExistsStmt = this.connection.prepare('SELECT txid FROM tx WHERE txid = ?')
// this.getTransactionHexStmt = this.connection.prepare('SELECT LOWER(HEX(bytes)) AS hex FROM tx WHERE txid = ?')
// this.getTransactionTimeStmt = this.connection.prepare('SELECT time FROM tx WHERE txid = ?')
// this.getTransactionHeightStmt = this.connection.prepare('SELECT height FROM tx WHERE txid = ?')
// this.getTransactionHasCodeStmt = this.connection.prepare('SELECT has_code FROM tx WHERE txid = ?')
// this.getTransactionIndexedStmt = this.connection.prepare('SELECT indexed FROM tx WHERE txid = ?')
// this.getTransactionWasExecutedStmt = this.connection.prepare('SELECT executed FROM tx WHERE txid = ?')
// this.getTransactionFailedStmt = this.connection.prepare('SELECT (executed = 1 AND indexed = 0) AS failed FROM tx WHERE txid = ?')
// this.getTransactionDownloadedStmt = this.connection.prepare('SELECT downloaded FROM tx WHERE txid = ?')
// this.deleteTransactionStmt = this.connection.prepare('DELETE FROM tx WHERE txid = ?')
// this.unconfirmTransactionStmt = this.connection.prepare(`UPDATE tx SET height = ${HEIGHT_MEMPOOL} WHERE txid = ?`)
// this.getTransactionsAboveHeightStmt = this.connection.prepare('SELECT txid FROM tx WHERE height > ?')
// this.getMempoolTransactionsBeforeTimeStmt = this.connection.prepare(`SELECT txid FROM tx WHERE height = ${HEIGHT_MEMPOOL} AND time < ?`)
// this.getTransactionsToDownloadStmt = this.connection.prepare('SELECT txid FROM tx WHERE downloaded = 0')
// this.getTransactionsDownloadedCountStmt = this.connection.prepare('SELECT COUNT(*) AS count FROM tx WHERE downloaded = 1')
// this.getTransactionsIndexedCountStmt = this.connection.prepare('SELECT COUNT(*) AS count FROM tx WHERE indexed = 1')
// this.isTrustedAndReadyToExecuteStmt = this.connection.prepare(TRUSTED_AND_READY_TO_EXECUTE_SQL)
// this.isReadyToExecuteStmt = this.connection.prepare(READY_TO_EXECUTE_SQL)
// this.depsExecutedOkStmt = this.connection.prepare(`
//     SELECT COUNT(*) = 0 as ok
//     FROM tx
//     JOIN deps ON deps.up = tx.txid
//     WHERE deps.down = ?
//     AND (+tx.downloaded = 0 OR (tx.executable = 1 AND tx.executed = 0))
// `)
// this.getDownstreamReadyToExecuteStmt = this.connection.prepare(GET_DOWNSTREAM_READY_TO_EXECUTE_SQL)
// this.getTxMetadataStmt = this.connection.prepare('SELECT * FROM tx WHERE txid = ?')
//
// this.setSpendStmt = this.connection.prepare('INSERT OR REPLACE INTO spends (location, spend_txid) VALUES (?, ?)')
// this.setUnspentStmt = this.connection.prepare('INSERT OR IGNORE INTO spends (location, spend_txid) VALUES (?, null)')
// this.getSpendStmt = this.connection.prepare('SELECT spend_txid FROM spends WHERE location = ?')
// this.unspendOutputsStmt = this.connection.prepare('UPDATE spends SET spend_txid = null WHERE spend_txid = ?')
// this.deleteSpendsStmt = this.connection.prepare('DELETE FROM spends WHERE location LIKE ? || \'%\'')
// //
// this.addDepStmt = this.connection.prepare('INSERT OR IGNORE INTO deps (up, down) VALUES (?, ?)')
// this.deleteDepsStmt = this.connection.prepare('DELETE FROM deps WHERE down = ?')
// this.getDownstreamStmt = this.connection.prepare('SELECT down FROM deps WHERE up = ?')
// this.getUpstreamUnexecutedCodeStmt = this.connection.prepare(`
//   SELECT txdeps.txid as txid
//   FROM (SELECT up AS txid FROM deps WHERE down = ?) as txdeps
//   JOIN tx ON tx.txid = txdeps.txid
//   WHERE tx.executable = 1 AND tx.executed = 0 AND tx.has_code = 1
// `)
// this.hasFailedDepStmt = this.connection.prepare(`
//   SELECT count(*) > 0 FROM tx
//   JOIN deps ON deps.up = tx.txid
//   WHERE
//       tx.txid = ? AND
//       tx.executed = 1 AND
//       tx.indexed = 0;
// `)
// //
// this.setJigStateStmt = this.connection.prepare('INSERT OR IGNORE INTO jig (location, state, class, lock, scripthash) VALUES (?, ?, null, null, null)')
// this.setJigMetadataStmt = this.connection.prepare('INSERT OR IGNORE INTO jig (location)  VALUES (?)')
// this.setJigClassStmt = this.connection.prepare('UPDATE jig SET class = ? WHERE location = ?')
// this.setJigLockStmt = this.connection.prepare('UPDATE jig SET lock = ? WHERE location = ?')
// this.setJigScripthashStmt = this.connection.prepare('UPDATE jig SET scripthash = ? WHERE location = ?')
// this.getJigStateStmt = this.connection.prepare('SELECT state FROM jig WHERE location = ?')
// this.deleteJigStatesStmt = this.connection.prepare('DELETE FROM jig WHERE location LIKE ? || \'%\'')
//
// const getAllUnspentSql = `
//   SELECT spends.location AS location FROM spends
//   JOIN jig ON spends.location = jig.location
//   WHERE spends.spend_txid IS NULL`
// this.getAllUnspentStmt = this.connection.prepare(getAllUnspentSql)
// this.getAllUnspentByClassStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.class = ?`)
// this.getAllUnspentByLockStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.lock = ?`)
// this.getAllUnspentByScripthashStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.scripthash = ?`)
// this.getAllUnspentByClassLockStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.class = ? AND lock = ?`)
// this.getAllUnspentByClassScripthashStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.class = ? AND scripthash = ?`)
// this.getAllUnspentByLockScripthashStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.lock = ? AND scripthash = ?`)
// this.getAllUnspentByClassLockScripthashStmt = this.connection.prepare(`${getAllUnspentSql} AND jig.class = ? AND jig.lock = ? AND scripthash = ?`)
// this.getNumUnspentStmt = this.connection.prepare('SELECT COUNT(*) as unspent FROM spends JOIN jig ON spends.location = jig.location WHERE spends.spend_txid IS NULL')
//
// this.setBerryStateStmt = this.connection.prepare('INSERT OR IGNORE INTO berry (location, state) VALUES (?, ?)')
// this.setBerryMetadataStmt = this.connection.prepare('INSERT OR IGNORE INTO berry (location) VALUES (?)')
// this.getBerryStateStmt = this.connection.prepare('SELECT state FROM berry WHERE location = ?')
// this.deleteBerryStatesStmt = this.connection.prepare('DELETE FROM berry WHERE location LIKE ? || \'%\'')
//
// this.setTrustedStmt = this.connection.prepare('INSERT OR REPLACE INTO trust (txid, value) VALUES (?, ?)')
// this.getTrustlistStmt = this.connection.prepare('SELECT txid FROM trust WHERE value = 1')
// this.isTrustedStmt = this.connection.prepare('SELECT COUNT(*) FROM trust WHERE txid = ? AND value = 1')
//
// this.banStmt = this.connection.prepare('INSERT OR REPLACE INTO ban (txid) VALUES (?)')
// this.unbanStmt = this.connection.prepare('DELETE FROM ban WHERE txid = ?')
// this.isBannedStmt = this.connection.prepare('SELECT COUNT(*) FROM ban WHERE txid = ?')
// this.getBanlistStmt = this.connection.prepare('SELECT txid FROM ban')
//
// this.getHeightStmt = this.connection.prepare('SELECT value FROM crawl WHERE key = \'height\'')
// this.getHashStmt = this.connection.prepare('SELECT value FROM crawl WHERE key = \'hash\'')
// this.setHeightStmt = this.connection.prepare('UPDATE crawl SET value = ? WHERE key = \'height\'')
// this.setHashStmt = this.connection.prepare('UPDATE crawl SET value = ? WHERE key = \'hash\'')
//
// this.markExecutingStmt = this.connection.prepare('INSERT OR IGNORE INTO executing (txid) VALUES (?)')
// this.unmarkExecutingStmt = this.connection.prepare('DELETE FROM executing WHERE txid = ?')
// this.findAllExecutingTxidsStmt = this.connection.prepare('SELECT txid FROM executing')

// The + in the following 2 queries before downloaded improves performance by NOT using the
// tx_downloaded index, which is rarely an improvement over a simple filter for single txns.
// See: https://www.sqlite.org/optoverview.html
// const TRUSTED_AND_READY_TO_EXECUTE_SQL = `
//       SELECT (
//         downloaded = 1
//         AND executable = 1
//         AND executed = 0
//         AND (has_code = 0 OR (SELECT COUNT(*) FROM trust WHERE trust.txid = tx.txid AND trust.value = 1) = 1)
//         AND txid NOT IN ban
//         AND (
//           SELECT COUNT(*)
//           FROM tx AS tx2
//           JOIN deps
//           ON deps.up = tx2.txid
//           WHERE deps.down = tx.txid
//           AND (+tx2.downloaded = 0 OR (tx2.executable = 1 AND tx2.executed = 0))
//         ) = 0
//       ) AS ready
//       FROM tx
//       WHERE txid = ?
//     `

// const READY_TO_EXECUTE_SQL = `
//       SELECT (
//               downloaded = 1
//               AND executable = 1
//               AND executed = 0
//               AND (
//                 SELECT COUNT(*)
//                 FROM tx AS tx2
//                 JOIN deps
//                 ON deps.up = tx2.txid
//                 WHERE deps.down = tx.txid AND
//                 (
//                   +tx2.downloaded = 0 OR
//                   (tx2.executable = 1 AND tx2.executed = 0) OR
//                   (tx2.executed = 1 AND tx2.indexed = 0)
//                 )
//               ) = 0
//             ) AS ready
//             FROM tx
//             WHERE txid = ?
// `

// const GET_DOWNSTREAM_READY_TO_EXECUTE_SQL = `
//       SELECT down
//       FROM deps
//       JOIN tx
//       ON tx.txid = deps.down
//       WHERE up = ?
//       AND +downloaded = 1
//       AND executable = 1
//       AND executed = 0
//       AND (has_code = 0 OR (SELECT COUNT(*) FROM trust WHERE trust.txid = tx.txid AND trust.value = 1) = 1)
//       AND txid NOT IN ban
//       AND (
//         SELECT COUNT(*)
//         FROM tx AS tx2
//         JOIN deps
//         ON deps.up = tx2.txid
//         WHERE deps.down = tx.txid
//         AND (+tx2.downloaded = 0 OR (tx2.executable = 1 AND tx2.executed = 0))
//       ) = 0
//     `

// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------

class SqliteDatasource {
  constructor (connectionUri, logger, readonly = false) {
    this.connectionUri = connectionUri
    this.knex = null
    this.logger = logger
    this.readonly = readonly
    this.connection = null
  }

  prepareStatements () {}

  async setUp () {
    this.knex = knex({
      client: 'pg',
      connection: this.connectionUri
    })
  }

  async tearDown () {
    if (this.knex) {
      await this.knex.destroy()
      this.knex = null
    }
  }

  async performOnTransaction (fn) {
    this.knex.transaction(async trx => {
      await fn(trx)
    })
  }

  async txExists (txid) {
    return this.knex(TX.NAME).exists({ txid })
  }

  async checkTxIsDownloaded (txid) {
    const result = await this.knex(TX.NAME).where(TX.txid, txid).whereNotNull('bytes').first([TX.txid])
    return !!result
  }

  async searchTxsAboveHeight (height) {
    return this.knex(TX.NAME).where(TX.height, '>', height).select()
  }

  async mempoolTxsPreviousToTime (time) {
    return this.knex(TX.NAME)
      .where(TX.height, HEIGHT_MEMPOOL)
      .where(TX.time, '<', time)
      .select()
  }

  async searchTxsToDownload () {
    return this.knex(TX.NAME).whereNotNull(TX.bytes).select()
  }

  async countDownloadedTxs () {
    const result = this.knex(TX.NAME).whereNotNull(TX.bytes).count(TX.txid, { as: 'count' }).first()
    return result.count
  }

  async countIndexedTxs () {
    const result = this.knex(TX.NAME).where(TX.indexed, true).count(TX.txid, { as: 'count' }).first()
    return result.count
  }

  async getFailedTx (deptxid) {
    const result = await this.knex(TX.NAME).where(TX.txid, deptxid).first()
    return result && result.executed && !result.indexed
  }

  async addNewTx (txid, time) {
    await this.knex(TX.NAME).insert({
      txid,
      time,
      height: null,
      bytes: null,
      has_code: false,
      executable: false,
      indexed: false
    })
  }

  async setTxHeight (txid, height) {
    await this.knex(TX.NAME)
      .where(TX.txid, txid)
      .where(qb => {
        qb.whereNull(TX.height).orWhere(TX.height, HEIGHT_MEMPOOL)
      })
      .update(TX.height, height)
  }

  async setTxTime (txid, time) {
    await this.knex(TX.NAME)
      .where(TX.txid, txid)
      .update(TX.time, time)
  }

  async setTxBytes (txid, bytes) {
    await this.knex(TX.NAME)
      .where(TX.txid, txid)
      .update(TX.bytes, bytes)
  }

  async setExecutableForTx (txid, executable) {
    await this.knex(TX.NAME)
      .where(TX.txid, txid)
      .update(TX.executable, executable)
  }

  async setHasCodeForTx (txid, hasCode) {
    await this.knex(TX.NAME)
      .where(TX.txid, txid)
      .update(TX.hasCode, hasCode)
  }

  async setExecutedForTx (txid, executed) {
    await this.knex(TX.NAME)
      .where(TX.txid, txid)
      .update(TX.executed, executed)
  }

  async setIndexedForTx (txid, indexed) {
    await this.knex(TX.NAME)
      .where(TX.txid, txid)
      .update(TX.indexed, indexed)
  }

  async txIsIndexed (txid) {
    const result = await this.knex(TX.NAME)
      .where(TX.txid, txid)
      .first([TX.txid])

    return result && result.indexed
  }

  async hasFailedDep (txid) {
    const result = this.knex(TX.NAME)
      .join(DEPS.NAME, `${DEPS.NAME}.${DEPS.up}`, `${TX.NAME}.${TX.txid}`)
      .join({ innerTx: TX.NAME }, `${DEPS.NAME}.${DEPS.down}`, `innerTx.${TX.txid}`)
      .where(`${TX.NAME}.${TX.txid}`, txid)
      .where(`innerTx.${TX.executed}`, true)
      .where(`innerTx.${TX.indexed}`, false)
      .count(`${TX.NAME}.${TX.txid}`, { as: 'count' })
      .first()
    return result.count > 0
  }

  async checkTxWasExecuted (txid) {
    const result = this.knex(TX.NAME).where(TX.txid, txid).first(TX.executed)
    return result && result.executed
  }

  async getTxHex (txid) {
    const result = await this.knex(TX.NAME).where(TX.txid, txid).first([TX.bytes])
    return result && result.bytes.toString('hex')
  }

  async getTxTime (txid) {
    const result = await this.knex(TX.NAME).where(TX.txid, txid).first([TX.time])
    return result && result.time
  }

  async getTxHeight (txid) {
    const result = await this.knex(TX.NAME).where(TX.txid, txid).first([TX.height])
    return result && result.height
  }

  async deleteTx (txid) {
    this.deleteTransactionStmt.run(txid)
  }

  async unconfirmTx (txid) {
    await this.knex(TX.NAME).where(TX.txid, txid).update(TX.height, HEIGHT_MEMPOOL)
  }

  async getTxMetadata (txid) {
    return this.knex(TX.NAME).where(TX.txid, txid).first()
  }
  // executing

  async markTxAsExecuting (txid) {
    await this.knex(EXECUTING.NAME)
      .insert({ txid })
      .onConflict(EXECUTING.txid)
      .ignore()
  }

  async removeTxFromExecuting (txid) {
    await this.knex(EXECUTING.NAME).where(EXECUTING.txid, txid).del()
  }

  async findAllExecutingTxids () {
    return this.knex(EXECUTING.NAME).select()
  }

  async txidTrustedAndReadyToExecute (txid) {
    // `
    //   SELECT (
    //     downloaded = 1
    //     AND executable = 1
    //     AND executed = 0
    //     AND (has_code = 0 OR (SELECT COUNT(*) FROM trust WHERE trust.txid = tx.txid AND trust.value = 1) = 1)
    //     AND txid NOT IN ban
    //     AND (
    //       SELECT COUNT(*)
    //       FROM tx AS tx2
    //       JOIN deps
    //       ON deps.up = tx2.txid
    //       WHERE deps.down = tx.txid
    //       AND (+tx2.downloaded = 0 OR (tx2.executable = 1 AND tx2.executed = 0))
    //     ) = 0
    //   ) AS ready
    //   FROM tx
    //   WHERE txid = ?
    // `
    this.knex(TX.NAME)
      .whereNotNull(TX.bytes)
      .andWhere(TX.executable, true)
      .andWhere(TX.executed, false)
      .andWhere(qb => {
        qb.where(TX.hasCode, false).orWhereExists(function () {
          this.select(TRUST.txid).from(TRUST.NAME).whereRaw(`${TRUST.txid} = ${TX.NAME}.${TX.txid}`).andWhere(TRUST.value, true)
        })
      })
      .andWhere(qb => {
        qb.not.exists(function () {
          this.join(DEPS.NAME, `${DEPS.NAME}.${DEPS.down}`, `${TX.NAME}.${TX.txid}`)
          this.join({ innerTx: TX.NAME }, `${DEPS.NAME}.${DEPS.up}`, `innerTx.${TX.txid}`)
          this.whereNotNull(`innerTx.${TX.bytes}`)
            .andWhere(`innerTX.${TX.executable}`, true)
            .andWhereNot(qb2 => {
              qb2.where(`innerTx.${TX.executable}`, true).andWhere(`innerTx.${TX.executed}`)
            })
        })
      })

    const row = this.isTrustedAndReadyToExecuteStmt.get(txid)
    return row && row.ready
  }

  async txidIsReadyToExecute (txid) {
    const row = this.isReadyToExecuteStmt.get(txid)
    return !!(row && row.ready)
  }

  async checkDependenciesWereExecutedOk (txid) {
    const row = this.depsExecutedOkStmt.get(txid)
    return row && row.ok
  }

  // spends

  async getSpendingTxid (location) {
    const row = this.getSpendStmt.raw(true).get(location)
    return row && row[0]
  }

  async upsertSpend (location, txid) {
    await this.setSpendStmt.run(location, txid)
  }

  async setAsUnspent (location) {
    this.setUnspentStmt.run(location)
  }

  async deleteSpendsForTxid (txid) {
    this.deleteSpendsStmt.run(txid)
  }

  async unspendOutput (txid) {
    this.unspendOutputsStmt.run(txid)
  }

  // deps

  async addDep (deptxid, txid) {
    this.addDepStmt.run(deptxid, txid)
  }

  async searchDownstreamTxidsReadyToExecute (txid) {
    return this.getDownstreamReadyToExecuteStmt.raw(true).all(txid).map(x => x[0])
  }

  async searchDownstreamForTxid (txid) {
    return this.getDownstreamStmt.raw(true).all(txid).map(x => x[0])
  }

  async deleteDepsForTxid (txid) {
    this.deleteDepsStmt.run(txid)
  }

  async getNonExecutedUpstreamTxIds (txid) {
    return this.getUpstreamUnexecutedCodeStmt.raw(true).all(txid).map(x => x[0])
  }

  // jig

  async setJigMetadata (location) {
    this.setJigMetadataStmt.run(location)
  }

  async getJigState (location) {
    const row = this.getJigStateStmt.raw(true).get(location)
    if (row && row[0]) {
      return JSON.parse(row[0])
    } else {
      return null
    }
  }

  async setJigState (location, stateObject) {
    this.setJigStateStmt.run(location, JSON.stringify(stateObject))
  }

  async setBerryState (location, stateObject) {
    this.setBerryStateStmt.run(location, JSON.stringify(stateObject))
  }

  async setBerryMetadata (location) {
    this.setBerryMetadataStmt.run(location)
  }

  async getBerryState (location) {
    const row = this.getBerryStateStmt.raw(true).get(location)
    if (row && row[0]) {
      return JSON.parse(row[0])
    } else {
      return null
    }
  }

  async setJigClass (location, cls) {
    this.setJigClassStmt.run(cls, location)
  }

  async setJigLock (location, lock) {
    this.setJigLockStmt.run(lock, location)
  }

  async setJigScriptHash (location, scriptHash) {
    this.setJigScripthashStmt.run(scriptHash, location)
  }

  async deleteJigStatesForTxid (txid) {
    this.deleteJigStatesStmt.run(txid)
  }

  async deleteBerryStatesForTxid (txid) {
    this.deleteBerryStatesStmt.run(txid)
  }

  // unspent

  async getAllUnspent () {
    return this.getAllUnspentStmt.raw(true).all().map(row => row[0])
  }

  async getAllUnspentByClassOrigin (origin) {
    return this.getAllUnspentByClassStmt.raw(true).all(origin).map(row => row[0])
  }

  async getAllUnspentByLockOrigin (origin) {
    return this.getAllUnspentByLockStmt.raw(true).all(origin).map(row => row[0])
  }

  async getAllUnspentByScripthash (scripthash) {
    return this.getAllUnspentByScripthashStmt.raw(true).all(scripthash).map(row => row[0])
  }

  async getAllUnspentByClassOriginAndLockOrigin (clsOrigin, lockOrigin) {
    return this.getAllUnspentByClassLockStmt.raw(true).all(clsOrigin, lockOrigin).map(row => row[0])
  }

  async getAllUnspentByClassOriginAndScripthash (clsOrigin, scripthash) {
    return this.getAllUnspentByClassScripthashStmt.raw(true).all(clsOrigin, scripthash).map(row => row[0])
  }

  async getAllUnspentByLockOriginAndScripthash (lockOrigin, scripthash) {
    return this.getAllUnspentByLockScripthashStmt.raw(true).all(lockOrigin, scripthash).map(row => row[0])
  }

  async getAllUnspentByClassOriginAndLockOriginAndScriptHash (clsOrigin, lockOrigin, scripthash) {
    return this.getAllUnspentByClassLockScripthashStmt.raw(true).all(clsOrigin, lockOrigin, scripthash).map(row => row[0])
  }

  async countTotalUnspent () {
    return this.getNumUnspentStmt.get().unspent
  }

  // trust

  async isTrusted (txid) {
    const row = this.isTrustedStmt.raw(true).get(txid)
    return !!row && !!row[0]
  }

  async setTrust (txid, trusted) {
    this.setTrustedStmt.run(txid, trusted)
  }

  async searchAllTrust () {
    return this.getTrustlistStmt.raw(true).all().map(x => x[0])
  }

  // ban

  async checkIsBanned (txid) {
    const row = this.isBannedStmt.raw(true).get(txid)
    return !!row && !!row[0]
  }

  async saveBan (txid) {
    this.banStmt.run(txid)
  }

  async removeBan (txid) {
    this.unbanStmt.run(txid)
  }

  async searchAllBans () {
    return this.getBanlistStmt.raw(true).all().map(x => x[0])
  }

  // crawl

  async setCrawlHeight (heigth) {
    this.setHeightStmt.run(heigth.toString())
  }

  async setCrawlHash (hash) {
    this.setHashStmt.run(hash)
  }

  async getCrawlHeight () {
    const row = this.getHeightStmt.raw(true).all()[0]
    return row && parseInt(row[0])
  }

  async getCrawlHash () {
    const row = this.getHashStmt.raw(true).all()[0]
    return row && row[0]
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = { SqliteDatasource }
