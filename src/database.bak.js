/**
 * database.js
 *
 * Layer between the database and the application
 */

const Run = require('run-sdk')
const bsv = require('bsv')
const { SqliteDatasource } = require('./sqlite-datasource')
const { HEIGHT_MEMPOOL, HEIGHT_UNKNOWN } = require('./constants')

// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------

class Database {
  constructor (path, logger, readonly = false) {
    this.db = new SqliteDatasource(path, logger, readonly)
    this.logger = logger

    this.onReadyToExecute = null
    this.onAddTransaction = null
    this.onDeleteTransaction = null
    this.onTrustTransaction = null
    this.onUntrustTransaction = null
    this.onBanTransaction = null
    this.onUnbanTransaction = null
    this.onUntrustTransaction = null
    this.onRequestDownload = null
    this.onUnindexTransaction = null
  }

  async open () {
    await this.db.setUp()
  }

  async close () {
    await this.db.tearDown()
  }

  async transaction (f) {
    return this.db.transaction(f)
  }

  // --------------------------------------------------------------------------
  // tx
  // --------------------------------------------------------------------------

  async addBlock (txids, txhexs, height, hash, time) {
    const indexes = new Array(txids.length).fill(null).map((_, i) => i)
    for (const index of indexes) {
      const txid = txids[index]
      const txHex = txhexs && txhexs[index]
      await this.addTransaction(txid, txHex, height, time)
    }
    await this.setHeight(height)
    await this.setHash(hash)
  }

  async addTransaction (txid, txhex, height, time) {
    await this.transaction(async () => {
      await this.addNewTransaction(txid)
      if (height) { await this.setTransactionHeight(txid, height) }
      if (time) { await this.setTransactionTime(txid, time) }
    })

    const downloaded = await this.isTransactionDownloaded(txid)
    if (downloaded) return

    if (txhex) {
      await this.parseAndStoreTransaction(txid, txhex)
    } else {
      if (this.onRequestDownload) { await this.onRequestDownload(txid) }
    }
  }

  async parseAndStoreTransaction (txid, hex) {
    if (await this.isTransactionDownloaded(txid)) return

    let metadata = null
    let bsvtx = null
    const inputs = []
    const outputs = []

    if (!hex) { throw new Error('No hex') }

    try {
      bsvtx = new bsv.Transaction(hex)

      bsvtx.inputs.forEach(input => {
        const location = `${input.prevTxId.toString('hex')}_o${input.outputIndex}`
        inputs.push(location)
      })

      bsvtx.outputs.forEach((output, n) => {
        if (output.script.isDataOut() || output.script.isSafeDataOut()) return
        outputs.push(`${txid}_o${n}`)
      })

      metadata = Run.util.metadata(hex)
    } catch (e) {
      this.logger.error(`${txid} => ${e.message}`)
      await this.storeParsedNonExecutableTransaction(txid, hex, inputs, outputs)
      return
    }

    const deps = new Set()

    for (let i = 0; i < metadata.in; i++) {
      const prevtxid = bsvtx.inputs[i].prevTxId.toString('hex')
      deps.add(prevtxid)
    }

    for (const ref of metadata.ref) {
      if (ref.startsWith('native://')) {
        continue
      } else if (ref.includes('berry')) {
        const reftxid = ref.slice(0, 64)
        deps.add(reftxid)
      } else {
        const reftxid = ref.slice(0, 64)
        deps.add(reftxid)
      }
    }

    const hasCode = metadata.exec.some(cmd => cmd.op === 'DEPLOY' || cmd.op === 'UPGRADE')

    await this.storeParsedExecutableTransaction(txid, hex, hasCode, deps, inputs, outputs)

    for (const deptxid of deps) {
      if (!await this.isTransactionDownloaded(deptxid)) {
        if (this.onRequestDownload) await this.onRequestDownload(deptxid)
      }
    }
  }

  async addNewTransaction (txid) {
    if (await this.hasTransaction(txid)) return

    const time = Math.round(Date.now() / 1000)

    await this.db.addNewTx(txid, time)

    if (this.onAddTransaction) { await this.onAddTransaction(txid) }
  }

  async setTransactionHeight (txid, height) {
    await this.db.setTxHeight(txid, height)
  }

  async setTransactionTime (txid, time) {
    await this.db.setTxTime(txid, time)
  }

  async storeParsedNonExecutableTransaction (txid, hex, inputs, outputs) {
    await this.transaction(async () => {
      const bytes = Buffer.from(hex, 'hex')

      await this.db.setTxBytes(txid, bytes)
      await this.db.setExecutableForTx(txid, 0)

      for (const location of inputs) {
        await this.db.upsertSpend(location, txid)
      }
      for (const location of outputs) {
        await this.db.setAsUnspend(location)
      }
    })

    // Non-executable might be berry data. We execute once we receive them.
    const downstreamReadyToExecute = this.db.searchDownstreamTxidsReadyToExecute(txid)
    for (const downtxid of downstreamReadyToExecute) {
      await this.db.markTxAsExecuting(downtxid)
      if (this.onReadyToExecute) { await this.onReadyToExecute(downtxid) }
    }
  }

  async storeParsedExecutableTransaction (txid, hex, hasCode, deps, inputs, outputs) {
    await this.transaction(async () => {
      const bytes = Buffer.from(hex, 'hex')
      await this.db.setTxBytes(txid, bytes)
      await this.db.setExecutableForTx(txid, 1)
      await this.db.setHasCodeForTx(txid, hasCode ? 1 : 0)

      for (const location of inputs) {
        await this.db.upsertSpend(location, txid)
      }

      for (const location of outputs) {
        await this.db.setAsUnspend(location)
      }

      for (const deptxid of deps) {
        await this.addNewTransaction(deptxid)
        await this.db.addDep(deptxid, txid)

        const failed = await this.db.getFailedTx(deptxid)
        if (failed) {
          await this.setTransactionExecutionFailed(txid)
          return
        }
      }
    })

    await this._checkExecutability(txid)
  }

  async storeExecutedTransaction (txid, result) {
    const { cache, classes, locks, scripthashes } = result

    await this.transaction(async () => {
      await this.db.setExecutedForTx(txid, 1)
      await this.db.setIndexedForTx(txid, 1)

      await this.db.removeTxFromExecuting(txid)

      for (const key of Object.keys(cache)) {
        if (key.startsWith('jig://')) {
          const location = key.slice('jig://'.length)
          await this.db.setJig(location, JSON.stringify(cache[key]))
          continue
        }

        if (key.startsWith('berry://')) {
          const location = key.slice('berry://'.length)
          await this.db.setBerry(location, JSON.stringify(cache[key]))
          continue
        }
      }

      for (const [location, cls] of classes) {
        await this.db.setJigClass(location, cls)
      }

      for (const [location, lock] of locks) {
        await this.db.setJigLock(location, lock)
      }

      for (const [location, scripthash] of scripthashes) {
        await this.db.setJigScriptHash(location, scripthash)
      }
    })

    const downstreamReadyToExecute = await this.db.searchDownstreamTxidsReadyToExecute(txid)
    for (const downtxid of downstreamReadyToExecute) {
      await this.db.markTxAsExecuting(downtxid)
      if (this.onReadyToExecute) { await this.onReadyToExecute(downtxid) }
    }
  }

  async setTransactionExecutionFailed (txid) {
    // await this.transaction(async () => {
    // })
    await this.db.setExecutableForTx(txid, 0)
    await this.db.setExecutedForTx(txid, 1)
    await this.db.setIndexedForTx(txid, 0)
    await this.db.removeTxFromExecuting(txid)

    // We try executing downstream transactions if this was marked executable but it wasn't.
    // This allows an admin to manually change executable status in the database.

    let executable = false
    try {
      const rawTx = await this.getTransactionHex(txid)
      Run.util.metadata(rawTx)
      executable = true
    } catch (e) { }

    if (!executable) {
      const downstream = await this.db.searchDownstreamForTxid(txid)
      for (const downtxid of downstream) {
        await this._checkExecutability(downtxid)
      }
    }
  }

  async getTransactionHex (txid) {
    return this.db.getTxHex(txid)
  }

  async getTransactionTime (txid) {
    return this.db.getTxTime(txid)
  }

  async getTransactionHeight (txid) {
    return this.db.getTxHeight(txid)
  }

  async deleteTransaction (txid, deleted = new Set()) {
    if (deleted.has(txid)) return

    const txids = [txid]
    deleted.add(txid)

    await this.transaction(async () => {
      while (txids.length) {
        const txid = txids.shift()

        if (this.onDeleteTransaction) { await this.onDeleteTransaction(txid) }


        await this.db.deleteTx(txid)
        await this.db.deleteJigStatesForTxid(txid)
        await this.db.deleteBerryStatesForTxid(txid)
        await this.db.deleteSpendsForTxid(txid)
        await this.db.unspendOutput(txid)
        await this.db.deleteDepsForTxid(txid)

        const downtxids = this.db.searchDownstreamForTxid(txid)

        for (const downtxid of downtxids) {
          if (deleted.has(downtxid)) continue
          deleted.add(downtxid)
          txids.push(downtxid)
        }
      }
    })
  }

  async unconfirmTransaction (txid) {
    await this.db.unconfirmTx(txid)
  }

  async unindexTransaction (txid) {
    await this.transaction(async () => {

      if (await this.txIsIndexed()) {
        await this.db.setExecutedForTx(txid, 0)
        await this.db.setIndexedForTx(txid, 0)
        await this.db.deleteJigStatesForTxid(txid)
        await this.db.deleteBerryStatesForTxid(txid)
        await this.db.removeTxFromExecuting(txid)

        const downloadedTxids = await this.db.searchDownstreamForTxid(txid)
        for (const downloadedTxid of downloadedTxids) {
          await this.unindexTransaction(downloadedTxid)
        }

        if (this.onUnindexTransaction) { await this.onUnindexTransaction(txid) }
      }
    })
  }

  async hasTransaction (txid) {
    return this.db.txExists(txid)
  }

  async isTransactionDownloaded (txid) {
    const result = this.db.checkTxIsDownloaded(txid)
    return result ? !!result[0] : false
  }

  async getTransactionsAboveHeight (height) {
    const txsOverHeight = await this.db.searchTxsAboveHeight(height)
    return txsOverHeight.map(row => row[0])
  }

  async getMempoolTransactionsBeforeTime (time) {
    const txs = await this.db.mempoolTxsPreviousToTime(time)
    return txs.map(row => row[0])
  }

  async getTransactionsToDownload () {
    const rows = await this.db.searchTxsToDownload()
    return rows.map(row => row[0])
  }

  async getDownloadedCount () {
    return this.db.countDownloadedTxs()
  }

  async getIndexedCount () {
    return this.countIndexedTxs()
  }

  // --------------------------------------------------------------------------
  // spends
  // --------------------------------------------------------------------------

  async getSpend (location) {
    return this.db.getSpendingTxid(location)
  }

  // --------------------------------------------------------------------------
  // deps
  // --------------------------------------------------------------------------

  async addDep (txid, deptxid) {
    await this.addNewTransaction(deptxid)

    await this.db.addDep(deptxid, txid)

    const failed = await this.db.getFailedTx(deptxid)
    if (failed) {
      await this.setTransactionExecutionFailed(deptxid)
    }
  }

  async addMissingDeps (txid, deptxids) {
    await this.transaction(async () => {
      for (const deptxid of deptxids) {
        await this.addDep(txid, deptxid)
      }
    })

    await this._checkExecutability(txid)
  }

  // --------------------------------------------------------------------------
  // jig
  // --------------------------------------------------------------------------

  async getJigState (location) {
    return this.db.getJigState(location)
  }

  // --------------------------------------------------------------------------
  // unspent
  // --------------------------------------------------------------------------

  async getAllUnspent () {
    return this.db.getAllUnspent()
  }

  async getAllUnspentByClassOrigin (origin) {
    return this.db.getAllUnspentByClassOrigin(origin)
  }

  async getAllUnspentByLockOrigin (origin) {
    return this.db.getAllUnspentByLockOrigin(origin)
  }

  async getAllUnspentByScripthash (scripthash) {
    return this.db.getAllUnspentByScripthash(scripthash)
  }

  async getAllUnspentByClassOriginAndLockOrigin (clsOrigin, lockOrigin) {
    return this.db.getAllUnspentByClassOriginAndLockOrigin(clsOrigin, lockOrigin)
  }

  async getAllUnspentByClassOriginAndScripthash (clsOrigin, scripthash) {
    return this.db.getAllUnspentByClassOriginAndScripthash(clsOrigin, scripthash)
  }

  async getAllUnspentByLockOriginAndScripthash (lockOrigin, scripthash) {
    return this.db.getAllUnspentByLockOriginAndScripthash(lockOrigin, scripthash)
  }

  async getAllUnspentByClassOriginAndLockOriginAndScripthash (clsOrigin, lockOrigin, scripthash) {
    return this.db.getAllUnspentByClassOriginAndLockOriginAndScripthash(clsOrigin, lockOrigin, scripthash)
  }

  async getNumUnspent () {
    return this.db.countTotalUnspent()
  }

  // --------------------------------------------------------------------------
  // berry
  // --------------------------------------------------------------------------

  async getBerryState (location) {
    return this.db.getBerry(location)
  }

  // --------------------------------------------------------------------------
  // trust
  // --------------------------------------------------------------------------

  async isTrusted (txid) {
    return this.db.isTrusted(txid)
  }

  async trust (txid) {
    if (await this.isTrusted(txid)) return

    const trusted = [txid]

    // Recursively trust code parents
    const queue = await this.db.getNonExecutedUpstreamTxIds(txid)
    const visited = new Set()
    while (queue.length) {
      const uptxid = queue.shift()
      if (visited.has(uptxid)) continue
      if (await this.isTrusted(uptxid)) continue
      visited.add(uptxid)
      trusted.push(txid)
      const txids = await this.db.getNonExecutedUpstreamTxIds(uptxid)
      txids.forEach(x => queue.push(x[0]))
    }

    for (const trustedTxid of trusted) {
      await this.db.setTrust(trustedTxid, 1)
    }

    for (const txid of trusted) {
      await this._checkExecutability(txid)
    }

    if (this.onTrustTransaction) {
      for (const txid of trusted) {
        await this.onTrustTransaction(txid)
      }
    }
  }

  async untrust (txid) {
    if (!await this.isTrusted(txid)) return
    await this.transaction(async () => {
      await this.unindexTransaction(txid)
      await this.db.setTrust(txid, 0)

    })
    if (this.onUntrustTransaction) await this.onUntrustTransaction(txid)
  }

  async getTrustlist () {
    return this.db.searchAllTrust()
  }

  // --------------------------------------------------------------------------
  // ban
  // --------------------------------------------------------------------------

  async isBanned (txid) {
    return this.db.checkIsBanned(txid)
  }

  async ban (txid) {
    await this.transaction(async () => {
      await this.unindexTransaction(txid)
      await this.db.saveBan(txid)
    })
    if (this.onBanTransaction) await this.onBanTransaction(txid)
  }

  async unban (txid) {
    await this.db.removeBan(txid)
    await this._checkExecutability(txid)
    if (this.onUnbanTransaction) await this.onUnbanTransaction(txid)
  }

  async getBanlist () {
    return this.db.searchAllBans()
  }

  // --------------------------------------------------------------------------
  // crawl
  // --------------------------------------------------------------------------

  async getHeight () {
    return this.db.getCrawlHeight()
  }

  async getHash () {
    return this.db.getCrawlHash()
  }

  async setHeight (height) {
    await this.db.setCrawlHeight(height)
  }

  async setHash (hash) {
    await this.db.setCrawlHash(hash)
  }

  // --------------------------------------------------------------------------
  // internal
  // --------------------------------------------------------------------------

  async loadTransactionsToExecute () {
    this.logger.debug('Loading transactions to execute')
    const txids = await this.db.findAllExecutingTxids()
    for (const txid of txids) {
      await this._checkExecutability(txid)
    }
  }

  async _checkExecutability (txid) {
    const row = await this.db.txidReadyToExecute(txid)
    if (row && row.ready) {
      await this.db.markTxAsExecuting(txid)
      if (this.onReadyToExecute) { await this.onReadyToExecute(txid) }
    }
  }
}

// ------------------------------------------------------------------------------------------------

Database.HEIGHT_MEMPOOL = HEIGHT_MEMPOOL

module.exports = Database
