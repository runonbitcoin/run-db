/**
 * indexer.test.js
 *
 * Main object that discovers, downloads, executes and stores RUN transactions
 */

const Database = require('./database')
// const Crawler = require('./crawler')
const crypto = require('crypto')
const Run = require('run-sdk')
const bsv = require('bsv')
const _ = require('lodash')
const { IndexerResult } = require('./model/indexer-result')

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

class Indexer {
  constructor (database, ds, blobs, trustList, executor, network, logger) {
    this.onDownload = null
    this.onFailToDownload = null
    this.onIndex = null
    this.onFailToIndex = null
    this.onBlock = null
    this.onReorg = null
    this.pendingRetries = new Map()

    this.logger = logger
    this.database = database
    this.ds = ds
    this.blobs = blobs
    this.trustList = trustList
    this.network = network

    this.executor = executor

    this.database.onReadyToExecute = this._onReadyToExecute.bind(this)
    this.database.onAddTransaction = this._onAddTransaction.bind(this)
    this.database.onDeleteTransaction = this._onDeleteTransaction.bind(this)
    this.database.onTrustTransaction = this._onTrustTransaction.bind(this)
    this.database.onUntrustTransaction = this._onUntrustTransaction.bind(this)
    this.database.onBanTransaction = this._onBanTransaction.bind(this)
    this.database.onUnbanTransaction = this._onUnbanTransaction.bind(this)
    this.database.onRequestDownload = this._onRequestDownload.bind(this)
    this.executor.onIndexed = this._onIndexed.bind(this)
    this.executor.onExecuteFailed = this._onExecuteFailed.bind(this)
    this.executor.onMissingDeps = this._onMissingDeps.bind(this)
  }

  async trust (txid) {
    const trusted = await this.trustList.trust(txid, this.ds)

    for (const txid of trusted) {
      const canExecuteNow = await this.trustList.checkExecutability(txid, this.ds)
      if (canExecuteNow) {
        await this.executor.execute(txid)
      }
    }
  }

  async indexTransaction (txBuf, blockHeight = null) {
    const txid = crypto.createHash('sha256').update(
      crypto.createHash('sha256').update(txBuf).digest()
    ).digest().reverse().toString('hex')

    const time = new Date()
    await this.ds.addNewTx(txid, time, blockHeight)

    const indexed = await this.ds.txIsIndexed(txid)
    if (indexed) return

    const parsed = await this.parseTx(txBuf)
    await this.storeTx(parsed)

    if (parsed.executable) {
      const canExecuteNow = await this.trustList.checkExecutability(parsed.txid, this.ds)
      if (canExecuteNow) {
        const trustList = await this.trustList.executionTrustList(this.ds)
        await this.executor.execute(parsed.txid, trustList)
        return new IndexerResult(
          true,
          [],
          [],
          await this.ds.searchDownstreamTxidsReadyToExecute(txid)
        )
      }
    }
    return new IndexerResult(
      false,
      await this.ds.nonExecutedDepsFor(parsed.txid),
      await this.trustList.missingTrustFor(txid, this.ds),
      []
    )
  }

  async storeTx (parsedTx) {
    await this.ds.performOnTransaction(async (ds) => {
      const bytes = parsedTx.txBuf

      await this.blobs.pushTx(parsedTx.txid, bytes)
      await ds.setExecutableForTx(parsedTx.txid, parsedTx.executable)

      for (const location of parsedTx.inputs) {
        await ds.upsertSpend(location, parsedTx.txid)
      }
      for (const location of parsedTx.outputs) {
        await ds.setAsUnspent(location)
      }

      if (parsedTx.executable) {
        await ds.setHasCodeForTx(parsedTx.txid, parsedTx.hasCode)

        for (const depTxid of parsedTx.deps) {
          await this.database.addNewTransaction(depTxid, ds)
          await ds.addNewTx(depTxid, new Date())
          await ds.addDep(depTxid, parsedTx.txid)

          const failed = await ds.getFailedTx(depTxid)
          if (failed) {
            await this.ds.setTransactionExecutionFailed(parsedTx.txid, ds)
            return
          }
        }
      }
    })
  }

  async parseTx (txBuf) {
    const hex = txBuf.toString('hex')
    let metadata = null
    let bsvtx = null

    if (!hex) { throw new Error('No hex') }

    bsvtx = new bsv.Transaction(hex)
    const txid = bsvtx.hash

    const inputs = bsvtx.inputs.map(input => {
      return `${input.prevTxId.toString('hex')}_o${input.outputIndex}`
    })

    const outputs = _.zip(bsvtx.outputs, _.range(bsvtx.outputs.length))
      .filter(([output, _index]) => !output.script.isDataOut() && !output.script.isSafeDataOut())
      .map(([_output, index]) => `${txid}_o${index}`)

    let executable
    try {
      metadata = Run.util.metadata(hex)
      executable = true
    } catch (e) {
      // this.logger.error(`${txid} => ${e.message}`)
      // await this.storeParsedNonExecutableTransaction(txid, hex, inputs, outputs)
      // return
      executable = false
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

    return {
      txid,
      hex,
      deps,
      inputs,
      outputs,
      hasCode,
      executable,
      txBuf
    }
  }

  async start () {
    this.logger.debug('Starting indexer')
    await this.database.loadTransactionsToExecute()
  }

  async stop () {
    for (const entry of this.pendingRetries.entries()) {
      clearTimeout(entry[1])
    }
    await this.executor.stop()
  }

  async _onDownloadTransaction (txid, hex, height, time) {
    this.logger.info(`Downloaded ${txid} (${this.downloader.remaining()} remaining)`)
    if (await this.ds.checkTxIsDownloaded(txid)) return
    if (height) { await this.ds.setTxHeight(txid, height) }
    if (time) { await this.ds.setTxTime(txid, time) }
    await this.database.parseAndStoreTransaction(txid, hex)
    if (this.onDownload) await this.onDownload(txid)
  }

  async _onFailedToDownloadTransaction (txid, e) {
    this.logger.error('Failed to download', txid, e.toString())
    if (this.onFailToDownload) { await this.onFailToDownload(txid) }
  }

  async _onRetryingDownload (txid, secondsToRetry) {
    this.logger.info('Retrying download', txid, 'after', secondsToRetry, 'seconds')
  }

  async _onIndexed (txid, result) {
    this.pendingRetries.delete(txid)
    if (!await this.ds.txExists(txid)) return // Check not re-orged
    this.logger.info(`Executed ${txid}`)
    // await this.database.storeExecutedTransaction(txid, result)

    const { cache, classes, locks, scripthashes } = result

    await this.ds.performOnTransaction(async (ds) => {
      await ds.setExecutedForTx(txid, 1)
      await ds.setIndexedForTx(txid, 1)
      await ds.removeTxFromExecuting(txid)

      for (const key of Object.keys(cache)) {
        if (key.startsWith('jig://')) {
          const location = key.slice('jig://'.length)
          await this.blobs.pushJigState(location, cache[key])
        } else if (key.startsWith('berry://')) {
          const location = key.slice('berry://'.length)
          await this.blobs.pushJigState(location, cache[key])
        }
      }

      for (const [location, cls] of classes) {
        await ds.setJigClass(location, cls)
      }

      for (const [location, lock] of locks) {
        await ds.setJigLock(location, lock)
      }

      for (const [location, scripthash] of scripthashes) {
        await ds.setJigScriptHash(location, scripthash)
      }
    })

    const downstreamReadyToExecute = await this.ds.searchDownstreamForTxid(txid)
    for (const downtxid of downstreamReadyToExecute) {
      await this.database._checkExecutability(downtxid)
    }

    if (this.onIndex) {
      await this.onIndex(txid)
    }
  }

  async _onExecuteFailed (txid, e, shouldRetry = false) {
    if (shouldRetry) {
      const timeout = setTimeout(() => { this._onReadyToExecute(txid) }, 10000)
      this.pendingRetries.set(txid, timeout)
    } else {
      this.pendingRetries.delete(txid)
      this.logger.error(`Failed to execute ${txid}: ${e.toString()}`)
      await this.database.setTransactionExecutionFailed(txid)
    }
    if (this.onFailToIndex) this.onFailToIndex(txid, e)
  }

  async _onReadyToExecute (txid) {
    await this.executor.execute(txid)
      .catch((e) =>
        console.warn(`error executing tx ${txid}: ${e.message}`)
      )
  }

  async _onAddTransaction (txid) {
    this.logger.info('Added', txid)
  }

  async _onDeleteTransaction (txid) {
    this.logger.info('Removed', txid)
    await this.downloader.remove(txid)
  }

  async _onTrustTransaction (txid) {
    this.logger.info('Trusted', txid)
  }

  async _onUntrustTransaction (txid) {
    this.logger.info('Untrusted', txid)
  }

  async _onBanTransaction (txid) {
    this.logger.info('Banned', txid)
  }

  async _onUnbanTransaction (txid) {
    this.logger.info('Unbanned', txid)
  }

  async _onRequestDownload (txid) {
    await this.downloader.add(txid)
  }

  async _onMissingDeps (txid, deptxids) {
    this.logger.debug(`Discovered ${deptxids.length} dep(s) for ${txid}`)
    await this.database.addMissingDeps(txid, deptxids)
    deptxids.forEach(deptxid => this.downloader.add(deptxid))
  }

  async _onCrawlError (e) {
    this.logger.error(`Crawl error: ${e.toString()}`)
  }

  async _onCrawlBlockTransactions (height, hash, time, txids, txhexs) {
    this.logger.info(`Crawled block ${height} for ${txids.length} transactions`)
    await this.database.addBlock(txids, txhexs, height, hash, time)
    if (this.onBlock) await this.onBlock(height)
  }

  async _onRewindBlocks (newHeight) {
    this.logger.info(`Rewinding to block ${newHeight}`)

    const txids = await this.database.getTransactionsAboveHeight(newHeight)
    // Put all transactions back into the mempool. This is better than deleting them, because
    // when we assume they will just go into a different block, we don't need to re-execute.
    // If they don't make it into a block, then they will be expired in time.
    for (const txid of txids) {
      await this.database.unconfirmTransaction(txid)
    }

    await this.database.setHeight(newHeight)
    await this.ds.nullCrawlHash(null)

    if (this.onReorg) this.onReorg(newHeight)
  }

  async _onMempoolTransaction (txid, hex) {
    await this.database.addTransaction(txid, hex, Database.HEIGHT_MEMPOOL, null)
  }

  async _onExpireMempoolTransactions () {
    const expirationTime = Math.round(Date.now() / 1000) - this.mempoolExpiration

    const expired = await this.database.getMempoolTransactionsBeforeTime(expirationTime)
    const deleted = new Set()
    for (const txid of expired) {
      await this.database.deleteTransaction(txid, deleted)
    }
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Indexer
