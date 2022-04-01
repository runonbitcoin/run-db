/**
 * database.js
 *
 * Layer between the database and the application
 */
const { HEIGHT_MEMPOOL, CRAWL_HASH, CRAWL_HEIGHT } = require('../constants')
const { TX, DEPS, EXECUTING, TRUST, BAN, SPEND, JIG, BERRY, CRAWL } = require('./columns')

class KnexDatasource {
  constructor (knex, logger, readonly = false) {
    this.knex = knex
    this.logger = logger
    this.readonly = readonly
    this.connection = null
    this.insideTx = false
  }

  prepareStatements () {}

  async setUp () {
    await this.knex.migrate.latest()
  }

  async tearDown () {
    if (this.knex) {
      await this.knex.destroy()
      this.knex = null
    }
  }

  async performOnTransaction (fn) {
    if (this.insideTx) {
      return fn(this)
    }

    return this.knex.transaction(async trx => {
      const newDs = new KnexDatasource(trx, this.logger, this.readonly)
      newDs.insideTx = true
      try {
        await fn(newDs)
        await trx.commit()
      } catch (e) {
        trx.rollback()
        console.error(e)
        throw e
      }
    })
  }

  async txExists (txid) {
    const row = await this.knex(TX.NAME).where(TX.txid, txid).first(TX.txid)
    return !!row
  }

  async checkTxIsDownloaded (txid) {
    const result = await this.knex(TX.NAME).where(TX.txid, txid).whereNotNull('bytes').first([TX.txid])
    return !!result
  }

  async searchTxsAboveHeight (height) {
    return this.knex(TX.NAME).where(TX.height, '>', height).pluck(TX.txid)
  }

  async mempoolTxsPreviousToTime (time) {
    return this.knex(TX.NAME)
      .where(TX.height, HEIGHT_MEMPOOL)
      .where(TX.time, '<', new Date(time))
      .pluck(TX.txid)
  }

  async searchTxsToDownload () {
    return this.knex(TX.NAME).whereNull(TX.bytes).pluck(TX.txid)
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

  async addNewTx (txid, time, height = null) {
    let query = this.knex(TX.NAME).insert({
      txid,
      time: new Date(time),
      height,
      has_code: false,
      executable: false,
      executed: false,
      indexed: false
    }).onConflict(TX.txid)

    query = height
      ? query.merge(TX.height)
      : query.ignore()

    await query
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
      .first(TX.indexed)

    return !!(result && result.indexed)
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
    return result && result.bytes && result.bytes.toString('hex')
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
    await this.knex(TX.NAME)
      .where(TX.txid, txid)
      .del()
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
    return this.knex(EXECUTING.NAME).pluck(EXECUTING.txid)
  }

  async txidTrustedAndReadyToExecute (txid) {
    const mainTx = 'mainTx'
    const knex = this.knex
    const row = await knex(this.knex.ref(TX.NAME).as(mainTx))
      .leftJoin(TRUST.NAME, `${TRUST.NAME}.${TRUST.txid}`, `${mainTx}.${TX.txid}`)
      .leftJoin(BAN.NAME, `${BAN.NAME}.${BAN.txid}`, `${mainTx}.${TX.txid}`)
      .where(`${mainTx}.${TX.txid}`, txid)
      .where(`${mainTx}.${TX.executable}`, true)
      .where(`${mainTx}.${TX.executed}`, false)
      .where(qb => {
        qb.where(`${mainTx}.${TX.hasCode}`, false)
          .orWhere(`${TRUST.NAME}.${TRUST.value}`, true)
      })
      .whereNull(`${BAN.NAME}.${BAN.txid}`)
      .whereNotExists(function () {
        const depTx = 'depTx'
        this.select(TX.txid).from(DEPS.NAME)
          .leftJoin(knex.ref(TX.NAME).as(depTx), DEPS.up, `${depTx}.${TX.txid}`)
          .where(DEPS.down, knex.ref(`${mainTx}.${TX.txid}`))
          .where(qb => {
            qb.whereNull(`${depTx}.${TX.txid}`).orWhere(qb => {
              qb.where(`${depTx}.${TX.executable}`, true)
              qb.where(`${depTx}.${TX.executed}`, false)
            })
          })
      }).first(`${mainTx}.${TX.txid}`)

    return !!row
  }

  async txidIsReadyToExecute (txid) {
    const mainTx = 'mainTx'
    const knex = this.knex
    const row = await knex(this.knex.ref(TX.NAME).as(mainTx))
      .leftJoin(BAN.NAME, `${BAN.NAME}.${BAN.txid}`, `${mainTx}.${TX.txid}`)
      .where(`${mainTx}.${TX.txid}`, txid)
      .where(`${mainTx}.${TX.executable}`, true)
      .where(`${mainTx}.${TX.executed}`, false)
      .whereNull(`${BAN.NAME}.${BAN.txid}`)
      .whereNotExists(function () {
        const depTx = 'depTx'
        this.select(TX.txid).from(DEPS.NAME)
          .leftJoin(knex.ref(TX.NAME).as(depTx), DEPS.up, `${depTx}.${TX.txid}`)
          .where(DEPS.down, knex.ref(`${mainTx}.${TX.txid}`))
          .where(qb => {
            qb.whereNull(`${depTx}.${TX.txid}`).orWhere(qb => {
              qb.where(`${depTx}.${TX.executable}`, true)
              qb.where(`${depTx}.${TX.executed}`, false)
            })
          })
      }).first(`${mainTx}.${TX.txid}`)

    return !!row
  }

  async checkDependenciesWereExecutedOk (txid) {
    const count = await this.knex(TX.NAME)
      .join(DEPS.NAME, `${DEPS.NAME}.${DEPS.up}`, `${TX.NAME}.${TX.txid}`)
      .where(DEPS.down, txid)
      .where(qb => {
        qb.whereNotNull(`${TX.NAME}.${TX.bytes}`).orWhere(qb => {
          qb.where(`${TX.NAME}.${TX.executable}`, true).andWhere(`${TX.NAME}.${TX.executed}`, false)
        })
      }).count()
    return count === 0
  }

  // spends

  async getSpendingTxid (location) {
    const row = await this.knex(SPEND.NAME).where(SPEND.location, location).first([SPEND.spendTxid])
    return row && row[SPEND.spendTxid]
  }

  async upsertSpend (location, txid) {
    await this.knex(SPEND.NAME)
      .insert({ [SPEND.location]: location, [SPEND.spendTxid]: txid })
      .onConflict(SPEND.location).merge()
  }

  async setAsUnspent (location) {
    await this.knex(SPEND.NAME)
      .insert({ [SPEND.location]: location, [SPEND.spendTxid]: null })
      .onConflict(SPEND.location).ignore()
  }

  async deleteSpendsForTxid (txid) {
    this.knex(SPEND.NAME).whereLike(SPEND.location, `${txid}%`)
  }

  async unspendOutput (txid) {
    await this.knex(SPEND.NAME)
      .whereLike(SPEND.location, `${txid}_o%`)
      .del()
  }

  // deps

  async addDep (deptxid, txid) {
    await this.knex(DEPS.NAME)
      .insert({ [DEPS.up]: deptxid, [DEPS.down]: txid })
      .onConflict([DEPS.up, DEPS.down]).ignore()
  }

  async searchDownstreamTxidsReadyToExecute (txid) {
    const knex = this.knex
    const mainDeps = 'mainDeps'
    const mainTx = 'mainTx'
    return knex(knex.ref(DEPS.NAME).as(mainDeps))
      .join(knex.ref(TX.NAME).as(mainTx), `${mainTx}.${TX.txid}`, `${mainDeps}.${DEPS.down}`)
      .leftJoin(BAN.NAME, `${BAN.NAME}.${BAN.txid}`, `${mainTx}.${TX.txid}`)
      .leftJoin(TRUST.NAME, `${mainTx}.${TX.txid}`, `${TRUST.NAME}.${TRUST.txid}`)
      .where(`${mainDeps}.${DEPS.up}`, txid)
      .where(`${mainTx}.${TX.executable}`, true)
      .where(`${mainTx}.${TX.executed}`, false)
      .whereNull(`${BAN.NAME}.${BAN.txid}`)
      .where(qb => {
        qb.where(`${mainTx}.${TX.hasCode}`, false).orWhere(`${TRUST.NAME}.${TRUST.value}`, true)
      })
      .whereNotExists(function () {
        const depTx = 'depTx'
        const deps2 = 'deps2'
        this.select(`${depTx}.${TX.txid}`).from(knex.ref(DEPS.NAME).as(deps2))
          .leftJoin(knex.ref(TX.NAME).as(depTx), `${deps2}.${DEPS.up}`, `${depTx}.${TX.txid}`)
          .where(`${deps2}.${DEPS.down}`, knex.ref(`${mainTx}.${TX.txid}`))
          .where(qb => {
            qb.where(`${depTx}.${TX.indexed}`, false).orWhereNull(`${depTx}.${TX.txid}`)
          })
      }).pluck(`${mainTx}.${TX.txid}`)
  }

  async searchDownstreamForTxid (txid) {
    const rows = await this.knex(DEPS.NAME).where(DEPS.up, txid).select([DEPS.down])
    return rows.map(r => r.down)
  }

  async deleteDepsForTxid (txid) {
    await this.knex(DEPS.NAME).where(DEPS.down, txid).del()
  }

  async getNonExecutedUpstreamTxIds (txid) {
    const rows = await this.knex(DEPS.NAME)
      .join(TX.NAME, TX.txid, DEPS.up)
      .where(DEPS.down, txid)
      .where(TX.executable, true)
      .where(TX.executed, false)
      .where(TX.hasCode, true)
      .select(DEPS.up)

    return rows.map(r => r.up)
  }

  async nonExecutedDepsFor (txid) {
    return this.knex(DEPS.NAME)
      .leftJoin(TX.NAME, `${TX.NAME}.${TX.txid}`, `${DEPS.NAME}.${DEPS.up}`)
      .where(`${DEPS.NAME}.${DEPS.down}`, txid)
      .where(`${TX.NAME}.${TX.indexed}`, false).orWhereNull(`${TX.NAME}.${TX.txid}`)
      .pluck(`${DEPS.NAME}.${DEPS.up}`)
  }

  async upstreamWithCode (txid) {
    return this.knex(DEPS.NAME)
      .join(TX.NAME, `${TX.NAME}.${TX.txid}`, `${DEPS.NAME}.${DEPS.up}`)
      .where(`${DEPS.NAME}.${DEPS.down}`, txid)
      .where(`${TX.NAME}.${TX.hasCode}`, true)
      .pluck(`${TX.NAME}.${TX.txid}`)
  }

  // jig

  async setJigMetadata (location, klass, lock, scriptHash) {
    await this.knex(JIG.NAME)
      .insert({
        [JIG.location]: location,
        [JIG.klass]: klass,
        [JIG.lock]: lock,
        [JIG.scriptHash]: scriptHash
      })
      .onConflict(JIG.location).merge(JIG.klass, JIG.lock, JIG.scriptHash)
  }

  async getJigState (location) {
    const row = await this.knex(JIG.NAME)
      .where(JIG.location, location)
      .first([JIG.state])
    if (row && row.state) {
      return row.state
    } else {
      return null
    }
  }

  async setJigState (location, stateObject) {
    await this.knex(JIG.NAME)
      .insert({ [JIG.location]: location, [JIG.state]: JSON.stringify(stateObject) })
      .onConflict().ignore()
  }

  async setBerryState (location, stateObject) {
    await this.knex(BERRY.NAME)
      .insert({ [BERRY.location]: location, [BERRY.state]: JSON.stringify(stateObject) })
      .onConflict().ignore()
  }

  async setBerryMetadata (location) {
    await this.knex(BERRY.NAME)
      .insert({ [BERRY.location]: location })
      .onConflict().ignore()
  }

  async getBerryState (location) {
    const row = await this.knex(BERRY.NAME)
      .where(BERRY.location, location)
      .first([BERRY.state])
    if (row && row.state) {
      return JSON.parse(row.state)
    } else {
      return null
    }
  }

  async setJigClass (location, cls) {
    await this.knex(JIG.NAME)
      .where(JIG.location, location)
      .update({ [JIG.klass]: cls })
  }

  async setJigLock (location, lock) {
    await this.knex(JIG.NAME)
      .where(JIG.location, location)
      .update({ [JIG.lock]: lock })
  }

  async setJigScriptHash (location, scriptHash) {
    await this.knex(JIG.NAME)
      .where(JIG.location, location)
      .update({ [JIG.scriptHash]: scriptHash })
  }

  async deleteJigStatesForTxid (txid) {
    await this.knex(JIG.NAME)
      .whereLike(JIG.location, `${txid}%`)
      .del()
  }

  async deleteBerryStatesForTxid (txid) {
    await this.knex(BERRY.NAME)
      .whereLike(BERRY.location, `${txid}%`)
      .del()
  }

  async getJigMetadata (location) {
    return await this.knex(JIG.NAME)
      .where(JIG.location, location)
      .first()
  }

  // unspent

  async getAllUnspent () {
    const rows = await this.knex(SPEND.NAME)
      .join(JIG.NAME, `${SPEND.NAME}.${SPEND.location}`, `${JIG.NAME}.${JIG.location}`)
      .whereNull(`${SPEND.NAME}.${SPEND.spendTxid}`)
      .select(this.knex.ref(`${JIG.NAME}.${JIG.location}`, { as: 'location' }))
    return rows.map(row => row.location)
  }

  async getAllUnspentByClassOrigin (origin) {
    const rows = await this.knex(SPEND.NAME)
      .join(JIG.NAME, `${SPEND.NAME}.${SPEND.location}`, `${JIG.NAME}.${JIG.location}`)
      .whereNull(`${SPEND.NAME}.${SPEND.spendTxid}`)
      .where(`${JIG.NAME}.${JIG.klass}`, origin)
      .select(this.knex.ref(`${JIG.NAME}.${JIG.location}`, { as: 'location' }))

    return rows.map(row => row.location)
  }

  async getAllUnspentByLockOrigin (origin) {
    const rows = await this.knex(SPEND.NAME)
      .join(JIG.NAME, `${SPEND.NAME}.${SPEND.location}`, `${JIG.NAME}.${JIG.location}`)
      .whereNull(`${SPEND.NAME}.${SPEND.spendTxid}`)
      .where(`${JIG.NAME}.${JIG.lock}`, origin)
      .select(this.knex.ref(`${JIG.NAME}.${JIG.location}`, { as: 'location' }))

    return rows.map(row => row.location)
  }

  async getAllUnspentByScripthash (scripthash) {
    const rows = await this.knex(SPEND.NAME)
      .join(JIG.NAME, `${SPEND.NAME}.${SPEND.location}`, `${JIG.NAME}.${JIG.location}`)
      .whereNull(`${SPEND.NAME}.${SPEND.spendTxid}`)
      .where(`${JIG.NAME}.${JIG.scriptHash}`, scripthash)
      .select(this.knex.ref(`${JIG.NAME}.${JIG.location}`, { as: 'location' }))

    return rows.map(row => row.location)
  }

  async getAllUnspentByClassOriginAndLockOrigin (clsOrigin, lockOrigin) {
    const rows = await this.knex(SPEND.NAME)
      .join(SPEND.NAME, `${SPEND.NAME}.${SPEND.location}`, `${JIG.NAME}.${JIG.location}`)
      .whereNull(`${SPEND.NAME}.${SPEND.spendTxid}`)
      .where(`${JIG.NAME}.${JIG.klass}`, clsOrigin)
      .where(`${JIG.NAME}.${JIG.lock}`, lockOrigin)
      .select(this.knex.ref(`${JIG.NAME}.${JIG.location}`, { as: 'location' }))

    return rows.map(row => row.location)
  }

  async getAllUnspentByClassOriginAndScripthash (clsOrigin, scripthash) {
    const rows = await this.knex(SPEND.NAME)
      .join(SPEND.NAME, `${SPEND.NAME}.${SPEND.location}`, `${JIG.NAME}.${JIG.location}`)
      .whereNull(`${SPEND.NAME}.${SPEND.spendTxid}`)
      .where(`${JIG.NAME}.${JIG.klass}`, clsOrigin)
      .where(`${JIG.NAME}.${JIG.scriptHash}`, scripthash)
      .select(this.knex.ref(`${JIG.NAME}.${JIG.location}`, { as: 'location' }))

    return rows.map(row => row.location)
  }

  async getAllUnspentByLockOriginAndScripthash (lockOrigin, scripthash) {
    const rows = await this.knex(SPEND.NAME)
      .join(SPEND.NAME, `${SPEND.NAME}.${SPEND.location}`, `${JIG.NAME}.${JIG.location}`)
      .whereNull(`${SPEND.NAME}.${SPEND.spendTxid}`)
      .where(`${JIG.NAME}.${JIG.lock}`, lockOrigin)
      .where(`${JIG.NAME}.${JIG.scriptHash}`, scripthash)
      .select(this.knex.ref(`${JIG.NAME}.${JIG.location}`, { as: 'location' }))

    return rows.map(row => row.location)
  }

  async getAllUnspentByClassOriginAndLockOriginAndScriptHash (clsOrigin, lockOrigin, scripthash) {
    const rows = await this.knex(SPEND.NAME)
      .join(SPEND.NAME, `${SPEND.NAME}.${SPEND.location}`, `${JIG.NAME}.${JIG.location}`)
      .whereNull(`${SPEND.NAME}.${SPEND.spendTxid}`)
      .where(`${JIG.NAME}.${JIG.klass}`, clsOrigin)
      .where(`${JIG.NAME}.${JIG.lock}`, lockOrigin)
      .where(`${JIG.NAME}.${JIG.scriptHash}`, scripthash)
      .select(this.knex.ref(`${JIG.NAME}.${JIG.location}`, { as: 'location' }))

    return rows.map(row => row.location)
  }

  async countTotalUnspent () {
    const row = await this.knex(SPEND.NAME)
      .join(JIG.NAME, `${SPEND.NAME}.${SPEND.location}`, `${JIG.NAME}.${JIG.location}`)
      .whereNull(`${SPEND.NAME}.${SPEND.spendTxid}`)
      .count(`${SPEND.NAME}.${SPEND.location}`, { as: 'count' }).first()
    return row.count
  }

  // trust
  async isTrusted (txid) {
    const row = await this.knex(TRUST.NAME)
      .where(TRUST.txid, txid)
      .first(TRUST.txid)

    return !!row
  }

  async setTrust (txid, trusted) {
    await this.knex(TRUST.NAME)
      .insert({ [TRUST.txid]: txid, [TRUST.value]: trusted })
      .onConflict(TRUST.txid).merge()
  }

  async searchAllTrust () {
    return this.knex(TRUST.NAME)
      .where(TRUST.value, true)
      .pluck(TRUST.txid)
  }

  // ban

  async checkIsBanned (txid) {
    const row = await this.knex(BAN.NAME).where(BAN.txid, txid).first([BAN.txid])
    return !!row
  }

  async saveBan (txid) {
    await this.knex(BAN.NAME)
      .insert({ [BAN.txid]: txid })
      .onConflict().merge()
  }

  async removeBan (txid) {
    await this.knex(BAN.NAME)
      .where(BAN.txid, txid)
      .del()
  }

  async searchAllBans () {
    return this.knex(BAN.NAME).pluck(BAN.txid)
  }

  // crawl

  async setCrawlHeight (heigth) {
    await this.knex(CRAWL.NAME)
      .insert({ [CRAWL.name]: CRAWL_HEIGHT, [CRAWL.value]: heigth.toString() })
      .onConflict(CRAWL.name).merge()
  }

  async setCrawlHash (hash) {
    await this.knex(CRAWL.NAME)
      .insert({ [CRAWL.name]: CRAWL_HASH, [CRAWL.value]: hash.toString() })
      .onConflict(CRAWL.name).merge()
  }

  async nullCrawlHash () {
    await this.knex(CRAWL.NAME)
      .where(CRAWL.name, CRAWL_HASH)
      .del()
  }

  async getCrawlHeight () {
    const row = await this.knex(CRAWL.NAME)
      .where(CRAWL.name, CRAWL_HEIGHT)
      .first([CRAWL.value])
    return row ? parseInt(row.value) : 0
  }

  async getCrawlHash () {
    const row = await this.knex(CRAWL.NAME)
      .where(CRAWL.name, CRAWL_HASH)
      .first([CRAWL.value])
    return row && row.value
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = { KnexDatasource }
