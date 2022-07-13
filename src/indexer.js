/**
 * indexer.test.js
 *
 * Main object that discovers, downloads, executes and stores RUN transactions
 */
const Run = require('run-sdk')
const bsv = require('bsv')
const _ = require('lodash')
const { IndexerResult } = require('./model/indexer-result')
const { UnknownTx } = require('./model/unknown-tx')

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

class Indexer {
  constructor (ds, blobs, trustList, executor, network, logger, ignoredApps = []) {
    this.logger = logger
    this.ds = ds
    this.blobs = blobs
    this.trustList = trustList
    this.network = network
    this.ignoredApps = ignoredApps

    this.executor = executor
  }

  async trust (txid) {
    return await this.trustList.trust(txid, this.ds)
  }

  async untrust (txid) {
    await this.trustList.untrust(txid, this.ds)
    return [txid]
  }

  async indexTxid (txid, blockHeight = null) {
    const txBuff = await this.blobs.pullTx(txid, () => null)
    if (txBuff === null) {
      await this.ds.addNewTx(txid, new Date(), null)
      await this.ds.setTransactionExecutionFailed(txid)
      this.logger.info(`[${txid}] transaction does not exist`)
      return new IndexerResult(
        true,
        false
      )
    } else {
      return this.indexTransaction(txBuff, blockHeight)
    }
  }

  async indexTransaction (txBuf, blockHeight = null) {
    const start = new Date()
    const parsed = await this.parseTx(txBuf)
    const txid = parsed.txid
    this.logger.debug(`[${txid}] received`)

    if (this.ignoredApps.includes(parsed.appName)) {
      this.logger.debug(`[${txid}] ignored app tx: ${parsed.appName}`)
      await this._setTransactionExecutionFailed(txid)
      return new IndexerResult(true, false)
    }

    const currentTx = await this.ds.getTx(txid, async () => this.storeTx(parsed, start, blockHeight))

    const deps = await this._hidrateDeps(parsed.deps)

    const trusted = await this.trustList.allTrusted([currentTx, ...deps].filter(tx => tx.hasCode).map(tx => tx.txid), this.ds)

    const failedDep = deps.some(dep => dep.hasFailed())

    const shouldExecute = currentTx.executable &&
      !currentTx.executed &&
      deps.every(dep => dep.isKnown()) &&
      deps.every(dep => dep.indexed) &&
      !failedDep &&
      trusted

    let execResult = null

    if (shouldExecute) {
      const trustList = await this.trustList.executionTrustList(this.ds)
      execResult = await this.executor.execute(txid, trustList)
      currentTx.executed = execResult.missingDeps.length === 0
      currentTx.indexed = execResult.success
      if (execResult.missingDeps.length > 0) {
        for (const depTxid of execResult.missingDeps) {
          await this.ds.addDep(depTxid, parsed.txid)
        }
      }
      if (execResult.success) {
        await this._onIndexed(txid, execResult.result)
      } else {
        await this._setTransactionExecutionFailed(txid)
      }
    } else if ((!trusted || failedDep) && !currentTx.executed) {
      currentTx.executed = true
      currentTx.indexed = false
      await this._setTransactionExecutionFailed(txid)
    }

    this.logger.debug(`[${txid}] finished. ${new Date().valueOf() - start.valueOf()} ms`)

    const indexerResult = new IndexerResult(
      currentTx.executed,
      currentTx.executed && !currentTx.hasFailed()
    )
    this.logger.info(`[${txid}] executed: ${indexerResult.executed}, success: ${indexerResult.success}`)
    return indexerResult
  }

  async _hidrateDeps (deps) {
    return Promise.all(deps.map(async (txid) =>
      this.ds.getTx(txid, () =>
        new UnknownTx(txid)
      ))
    )
  }

  async _searchEnablementsFor (txid) {
    const executableDownstram = await this.ds.searchDownstreamTxidsReadyToExecute(txid)
    const res = []
    for (const depTxid of executableDownstram) {
      if (await this._shouldQueuExecution(depTxid)) {
        res.push(depTxid)
      }
    }
    return res
  }

  async _shouldQueuExecution (txid) {
    const deps = await this.ds.fullDepsFor(txid)
    if (deps.some(d => !d.isReady())) {
      return false
    } else if (deps.some(d => !d.isKnown())) {
      return false
    } else if (deps.some(d => d.hasFailed())) {
      return true // We need to mark this tx as failed also.
    } else if (deps.some(d => d.isBanned())) {
      return false
    } else {
      return await this.trustList.trustedToExecute(txid, this.ds)
    }
  }

  async storeTx (parsedTx, time, blockHeight) {
    return this.ds.performOnTransaction(async (ds) => {
      const bytes = parsedTx.txBuf

      await this.blobs.pushTx(parsedTx.txid, bytes)
      const txMetadata = await ds.insertTx({
        txid: parsedTx.txid,
        height: blockHeight,
        time: time,
        indexed: !parsedTx.executable, // If the tx is not executable then is already indexed.
        executed: false,
        executable: parsedTx.executable,
        hasCode: parsedTx.hasCode
      })

      if (parsedTx.executable) {
        for (const depTxid of parsedTx.deps) {
          await ds.addDep(depTxid, parsedTx.txid)
        }
      }

      for (const location of parsedTx.inputs) {
        await ds.upsertSpend(location, parsedTx.txid)
      }
      for (const location of parsedTx.outputs) {
        await ds.setAsUnspent(location)
      }

      return txMetadata
    })
  }

  parseTx (txBuf) {
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

    let executable = false
    try {
      metadata = Run.util.metadata(hex)
      executable = true
    } catch (e) {
      // noop
    }

    const deps = executable ? Run.util.deps(hex) : []

    const hasCode = metadata && metadata.exec.some(cmd => cmd.op === 'DEPLOY' || cmd.op === 'UPGRADE')
    const appName = metadata ? metadata.app : null

    return {
      appName,
      deps,
      executable,
      hasCode,
      hex,
      inputs: inputs,
      outputs: outputs,
      txBuf,
      txid
    }
  }

  async start () {
    this.logger.debug('Starting indexer')
  }

  async stop () {}

  async _onIndexed (txid, result) {
    if (!await this.ds.txExists(txid)) return // Check not re-orged
    this.logger.debug(`[${txid}] Executed`)

    const { cache, classes, locks, scripthashes } = result

    await this.ds.performOnTransaction(async (ds) => {
      await ds.setExecutedForTx(txid, 1)
      await ds.setIndexedForTx(txid, 1)
      for (const key of Object.keys(cache)) {
        if (key.startsWith('jig://')) {
          const location = key.slice('jig://'.length)
          await this.blobs.pushJigState(location, cache[key])
          const klass = classes.find(([loc]) => loc === location)
          const lock = locks.find(([loc]) => loc === location)
          const scriptHash = scripthashes.find(([loc]) => loc === location)
          await ds.setJigMetadata(
            location,
            klass && klass[1],
            lock && lock[1],
            scriptHash && scriptHash[1]
          )
        } else if (key.startsWith('berry://')) {
          const location = key.slice('berry://'.length)
          const klass = classes.find(([loc]) => loc === location)
          await ds.setBerryMetadata(location, klass && klass[1])
          await this.blobs.pushJigState(location, cache[key])
        }
      }
    })
  }

  async _setTransactionExecutionFailed (txid) {
    await this.ds.setTransactionExecutionFailed(txid)
  }

  async _onMissingDeps (txid, deptxids) {
    this.logger.debug(`Discovered ${deptxids.length} dep(s) for ${txid}`)

    await this.ds.performOnTransaction(async (ds) => {
      for (const deptxid of deptxids) {
        await ds.addDep(deptxid, txid)
      }
    })
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Indexer
