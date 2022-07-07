class IndexerResult {
  constructor (executed, success, missingDeps, unknownDeps, enables) {
    this.executed = executed
    this.success = success
    this.missingDeps = missingDeps
    this.unknownDeps = unknownDeps
    this.enables = enables
  }
}

module.exports = { IndexerResult }
