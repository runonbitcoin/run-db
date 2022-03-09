/**
 * database.js
 *
 * Layer between the database and the application
 */

const Run = require('run-sdk')
const bsv = require('bsv')
const { HEIGHT_MEMPOOL, HEIGHT_UNKNOWN } = require('./constants')
// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------

class Database {
  constructor (datasource, trustList, logger) {
    this.ds = datasource
    this.trustList = trustList
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
  }

  get db () {
    return this.ds.connection
  }

  async open () {
    await this.ds.setUp()
  }

  async close () {
    await this.ds.tearDown()
  }

  async transaction (f) {
    await this.ds.performOnTransaction(f)
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
    await this.ds.performOnTransaction(async () => {
      await this.addNewTransaction(txid)
      if (height) { await this.setTransactionHeight(txid, height) }
      if (time) { await this.setTransactionTime(txid, time) }
    })

    const indexed = await this.isTransactionIndexed(txid)
    if (indexed) return
    if (!txhex) {
      txhex = await this.ds.getTxHex(txid)
    }
    if (txhex) {
      await this.parseAndStoreTransaction(txid, txhex)
    } else {
      if (this.onRequestDownload) { await this.onRequestDownload(txid) }
    }
  }

  async parseAndStoreTransaction (txid, hex) {
    if (await this.ds.checkTxWasExecuted(txid)) return

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
    await this.ds.addNewTx(txid, time)

    if (this.onAddTransaction) { await this.onAddTransaction(txid) }
  }

  async setTransactionHeight (txid, height) {
    await this.ds.setTxHeight(txid, height)
  }

  async setTransactionTime (txid, time) {
    await this.ds.setTxTime(txid, time)
  }

  async storeParsedNonExecutableTransaction (txid, hex, inputs, outputs) {
    await this.ds.performOnTransaction(async () => {
      const bytes = Buffer.from(hex, 'hex')
      await this.ds.setTxBytes(txid, bytes)
      await this.ds.setExecutableForTx(txid, 0)

      for (const location of inputs) {
        await this.ds.upsertSpend(location, txid)
      }
      for (const location of outputs) {
        await this.ds.setAsUnspent(location)
      }
    })

    // Non-executable might be berry data. We execute once we receive them.
    const downstreamReadyToExecute = await this.ds.searchDownstreamTxidsReadyToExecute(txid)
    for (const downtxid of downstreamReadyToExecute) {
      await this._checkExecutability(downtxid)
    }
  }

  async storeParsedExecutableTransaction (txid, hex, hasCode, deps, inputs, outputs) {
    await this.ds.performOnTransaction(async () => {
      const bytes = Buffer.from(hex, 'hex')
      await this.ds.setTxBytes(txid, bytes)
      await this.ds.setExecutableForTx(txid, 1)

      await this.ds.setHasCodeForTx(txid, hasCode ? 1 : 0)

      for (const location of inputs) {
        await this.ds.upsertSpend(location, txid)
      }
      for (const location of outputs) {
        await this.ds.setAsUnspent(location)
      }

      for (const deptxid of deps) {
        await this.addNewTransaction(deptxid)
        await this.ds.addDep(deptxid, txid)

        const failed = await this.ds.getFailedTx(deptxid)
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

    await this.ds.performOnTransaction(async () => {
      await this.ds.setExecutedForTx(txid, 1)
      await this.ds.setIndexedForTx(txid, 1)
      await this.ds.removeTxFromExecuting(txid)

      for (const key of Object.keys(cache)) {
        if (key.startsWith('jig://')) {
          const location = key.slice('jig://'.length)
          await this.ds.setJigState(location, cache[key])
        } else if (key.startsWith('berry://')) {
          const location = key.slice('berry://'.length)
          await this.ds.setBerryState(location, cache[key])
        }
      }

      for (const [location, cls] of classes) {
        await this.ds.setJigClass(location, cls)
      }

      for (const [location, lock] of locks) {
        await this.ds.setJigLock(location, lock)
      }

      for (const [location, scripthash] of scripthashes) {
        await this.ds.setJigScriptHash(location, scripthash)
      }
    })

    const downstreamReadyToExecute = await this.ds.searchDownstreamForTxid(txid)
    for (const downtxid of downstreamReadyToExecute) {
      await this._checkExecutability(downtxid)
    }
  }

  async setTransactionExecutionFailed (txid) {
    await this.ds.setExecutableForTx(txid, 0)
    await this.ds.setExecutedForTx(txid, 1)
    await this.ds.setIndexedForTx(txid, 0)
    await this.ds.removeTxFromExecuting(txid)

    // We try executing downstream transactions if this was marked executable but it wasn't.
    // This allows an admin to manually change executable status in the database.

    // let executable = false
    // try {
    //   const rawTx = await this.getTransactionHex(txid)
    //   Run.util.metadata(rawTx)
    //   executable = true
    // } catch (e) { }

    // if (!executable) {
    const downstream = await this.ds.searchDownstreamForTxid(txid)
    for (const downtxid of downstream) {
      await this._checkExecutability(downtxid)
    }
    // }
  }

  async getTransactionHex (txid) {
    return this.ds.getTxHex(txid)
  }

  async getTransactionTime (txid) {
    return this.ds.getTxTime(txid)
  }

  async getTransactionHeight (txid) {
    return this.ds.getTxHeight(txid)
  }

  async deleteTransaction (txid, deleted = new Set()) {
    if (deleted.has(txid)) return

    const txids = [txid]
    deleted.add(txid)

    await this.ds.performOnTransaction(async () => {
      while (txids.length) {
        const txid = txids.shift()

        if (this.onDeleteTransaction) { await this.onDeleteTransaction(txid) }

        await this.ds.deleteTx(txid)
        await this.ds.deleteJigStatesForTxid(txid)
        await this.ds.deleteBerryStatesForTxid(txid)
        await this.ds.deleteSpendsForTxid(txid)
        await this.ds.unspendOutput(txid)
        await this.ds.deleteDepsForTxid(txid)

        const downtxids = await this.ds.searchDownstreamForTxid(txid)

        for (const downtxid of downtxids) {
          if (deleted.has(downtxid)) continue
          deleted.add(downtxid)
          txids.push(downtxid)
        }
      }
    })
  }

  async unconfirmTransaction (txid) {
    await this.ds.unconfirmTx(txid)
  }

  async unindexTransaction (txid) {
    await this.ds.performOnTransaction(async () => {
      const indexed = await this.ds.txIsIndexed(txid)
      if (indexed) {
        await this.ds.setExecutedForTx(txid, 0)
        await this.ds.setIndexedForTx(txid, 0)
        await this.ds.deleteJigStatesStmt(txid)
        await this.ds.deleteBerryStatesForTxid(txid)
        await this.ds.removeTxFromExecuting(txid)

        const downloadedTxids = await this.ds.searchDownstreamForTxid(txid)
        for (const downloadedTxid of downloadedTxids) {
          await this.unindexTransaction(downloadedTxid)
        }

        if (this.onUnindexTransaction) { await this.onUnindexTransaction(txid) }
      }
    })
  }

  async hasTransaction (txid) {
    return this.ds.txExists(txid)
  }

  async isTransactionDownloaded (txid) {
    return this.ds.checkTxIsDownloaded(txid)
  }

  async isTransactionIndexed (txid) {
    return this.ds.txIsIndexed(txid)
  }

  async getTransactionsAboveHeight (height) {
    return this.ds.searchTxsAboveHeight(height)
  }

  async getMempoolTransactionsBeforeTime (time) {
    return this.ds.mempoolTxsPreviousToTime(time)
  }

  async getTransactionsToDownload () {
    return this.ds.searchTxsToDownload()
  }

  async getTxMetadata (txid) {
    return this.ds.getTxMetadata(txid)
  }

  async getDownloadedCount () {
    return this.ds.countDownloadedTxs()
  }

  async getIndexedCount () {
    return this.ds.countIndexedTxs()
  }

  // --------------------------------------------------------------------------
  // spends
  // --------------------------------------------------------------------------

  async getSpend (location) {
    return this.ds.getSpendingTxid(location)
  }

  // --------------------------------------------------------------------------
  // deps
  // --------------------------------------------------------------------------

  async addDep (txid, deptxid) {
    await this.addNewTransaction(deptxid)

    await this.ds.addDep(deptxid, txid)

    const failed = await this.ds.getFailedTx(deptxid)
    if (failed) {
      await this.setTransactionExecutionFailed(deptxid)
    }
  }

  async addMissingDeps (txid, deptxids) {
    await this.ds.performOnTransaction(async () => {
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
    return this.ds.getJigState(location)
  }

  // --------------------------------------------------------------------------
  // unspent
  // --------------------------------------------------------------------------

  async getAllUnspent () {
    return this.ds.getAllUnspent()
  }

  async getAllUnspentByClassOrigin (origin) {
    return this.ds.getAllUnspentByClassOrigin(origin)
  }

  async getAllUnspentByLockOrigin (origin) {
    return this.ds.getAllUnspentByLockOrigin(origin)
  }

  async getAllUnspentByScripthash (scripthash) {
    return this.ds.getAllUnspentByScripthash(scripthash)
  }

  async getAllUnspentByClassOriginAndLockOrigin (clsOrigin, lockOrigin) {
    return this.ds.getAllUnspentByClassOriginAndLockOrigin(clsOrigin, lockOrigin)
  }

  async getAllUnspentByClassOriginAndScripthash (clsOrigin, scripthash) {
    return this.ds.getAllUnspentByClassOriginAndScripthash(clsOrigin, scripthash)
  }

  async getAllUnspentByLockOriginAndScripthash (lockOrigin, scripthash) {
    return this.ds.getAllUnspentByLockOriginAndScripthash(lockOrigin, scripthash)
  }

  async getAllUnspentByClassOriginAndLockOriginAndScripthash (clsOrigin, lockOrigin, scripthash) {
    return this.ds.getAllUnspentByClassOriginAndLockOriginAndScriptHash(clsOrigin, lockOrigin, scripthash)
  }

  async getNumUnspent () {
    return this.ds.countTotalUnspent()
  }

  // --------------------------------------------------------------------------
  // berry
  // --------------------------------------------------------------------------

  async getBerryState (location) {
    return this.ds.getBerryState(location)
  }

  // --------------------------------------------------------------------------
  // trust
  // --------------------------------------------------------------------------

  async isTrusted (txid) {
    return this.ds.isTrusted(txid)
  }

  async trust (txid) {
    const trusted = await this.trustList.trust(txid)

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
    await this.ds.performOnTransaction(async () => {
      await this.unindexTransaction(txid)
      await this.trustList.untrust(txid)
    })
    if (this.onUntrustTransaction) await this.onUntrustTransaction(txid)
  }

  async getTrustlist () {
    return this.trustList.executionTrustList()
  }

  // --------------------------------------------------------------------------
  // ban
  // --------------------------------------------------------------------------

  async isBanned (txid) {
    return this.ds.checkIsBanned(txid)
  }

  async ban (txid) {
    await this.ds.performOnTransaction(async () => {
      await this.unindexTransaction(txid)
      await this.ds.saveBan(txid)
    })
    if (this.onBanTransaction) await this.onBanTransaction(txid)
  }

  async unban (txid) {
    await this.ds.removeBan(txid)
    await this._checkExecutability(txid)
    if (this.onUnbanTransaction) await this.onUnbanTransaction(txid)
  }

  async getBanlist () {
    return this.ds.searchAllBans()
  }

  // --------------------------------------------------------------------------
  // crawl
  // --------------------------------------------------------------------------

  async getHeight () {
    return this.ds.getCrawlHeight()
  }

  async getHash () {
    return this.ds.getCrawlHash()
  }

  async setHeight (height) {
    await this.ds.setCrawlHeight(height)
  }

  async setHash (hash) {
    await this.ds.setCrawlHash(hash)
  }

  // --------------------------------------------------------------------------
  // internal
  // --------------------------------------------------------------------------

  async loadTransactionsToExecute () {
    this.logger.debug('Loading transactions to execute')

    const txids = await this.ds.findAllExecutingTxids()
    for (const txid of txids) {
      await this._checkExecutability(txid)
    }
  }

  async _checkExecutability (txid) {
    const executable = await this.trustList.checkExecutability(txid)

    if (executable) {
      await this.ds.markTxAsExecuting(txid)
      if (this.onReadyToExecute) { await this.onReadyToExecute(txid) }
    }
  }
}

// ------------------------------------------------------------------------------------------------

Database.HEIGHT_MEMPOOL = HEIGHT_MEMPOOL
Database.HEIGHT_UNKNOWN = HEIGHT_UNKNOWN

module.exports = Database
