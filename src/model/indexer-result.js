class IndexerResult {
  constructor (executed, missingDeps, missingTrust, enables) {
    this.executed = executed
    this.missingDeps = missingDeps
    this.missingTrust = missingTrust
    this.enables = enables
  }
}

module.exports = { IndexerResult }
