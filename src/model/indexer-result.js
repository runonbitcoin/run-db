class IndexerResult {
  constructor (executed, missingDeps, unknownDeps, missingTrust, enables) {
    this.executed = executed
    this.missingDeps = missingDeps
    this.unknownDeps = unknownDeps
    this.missingTrust = missingTrust
    this.enables = enables
  }
}

module.exports = { IndexerResult }
