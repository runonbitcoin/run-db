class ExecutionResult {
  constructor (success, missingDeps, result, error = null) {
    this.success = success
    this.missingDeps = missingDeps
    this.result = result
    this.error = error
  }
}

module.exports = { ExecutionResult }
