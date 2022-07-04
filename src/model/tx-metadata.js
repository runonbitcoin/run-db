class TxMetadata {
  constructor (
    txid,
    height,
    time,
    hasCode,
    executable,
    executed,
    indexed,
    isBanned
  ) {
    this.txid = txid
    this.height = height
    this.time = time
    this.hasCode = hasCode
    this.executable = executable
    this.executed = executed
    this.indexed = indexed
    this._isBanned = isBanned
  }

  hasFailed () {
    return this.executed && !this.indexed
  }

  isReady () {
    return !this.executable || this.executed
  }

  isBanned () {
    return this.hasCode && this._isBanned
  }

  isKnown () {
    return true
  }

  static fromObject (obj) {
    return new this(
      obj.txid,
      obj.height,
      obj.time,
      obj.has_code,
      obj.executable,
      obj.executed,
      obj.indexed,
      obj.isBanned
    )
  }
}

module.exports = { TxMetadata }
