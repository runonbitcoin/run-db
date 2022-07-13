/**
 * indexer.test.js
 *
 * starts executions after indexing
 */
const { PostIndexerResult } = require('./model/post-indexer-result')

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

class PostIndexer {
  constructor (ds, logger) {
    this.ds = ds
    this.logger = logger
  }

  async process (txid, executed, _success) {
    const enablements = executed
      ? await this._searchEnablementsFor(txid)
      : []
    const deps = executed
      ? []
      : await this.ds.fullDepsFor(txid)

    return new PostIndexerResult(
      enablements,
      deps.filter(d => !d.executed || !d.isKnown()).map(d => d.txid)
    )
  }

  async setUp () {
    this.logger.debug('Starting post-indexer')
  }

  async tearDown () {}

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
    return deps.some(d => d.hasFailed()) || // If a dep failed should process to mark as failed.
      deps.some(d => !d.isKnown()) || // if a dep is unknown should process to force to queue that dep.
      deps.every(d => d.isReady()) || // if every dep is ready should queue to execute.
      deps.some(d => d.isBanned()) // if a dep is banned should queue to mark as failed.
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = { PostIndexer }
