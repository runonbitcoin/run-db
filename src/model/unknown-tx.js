class UnknownTx {
  constructor (
    txid
  ) {
    this.txid = txid
  }

  hasFailed () {
    return false
  }

  isReady () {
    return false
  }

  isBanned () {
    return false
  }

  isKnown () {
    return false
  }
}

module.exports = { UnknownTx }
