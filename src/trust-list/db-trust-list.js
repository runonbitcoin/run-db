class DbTrustList {
  constructor (ds) {
    this.ds = ds
  }

  async executionTrustList () {
    return this.ds.searchAllTrust()
  }

  async checkExecutability (txid) {
    return this.ds.txidTrustedAndReadyToExecute(txid)
  }

  async trust (txid) {
    if (await this.ds.isTrusted(txid)) return []

    const trusted = [txid]

    // Recursively trust code parents
    const queue = await this.ds.getNonExecutedUpstreamTxIds(txid)
    const visited = new Set()
    while (queue.length) {
      const uptxid = queue.shift()
      if (visited.has(uptxid)) continue
      if (await this.ds.isTrusted(uptxid)) continue
      visited.add(uptxid)
      trusted.push(txid)
      const nextTxids = await this.ds.getNonExecutedUpstreamTxIds(uptxid)
      nextTxids.forEach(txid => queue.push(txid))
    }

    for (const trustedTxid of trusted) {
      await this.ds.setTrust(trustedTxid, 1)
    }
    return trusted
  }

  async untrust (txid) {
    await this.ds.setTrust(txid, 0)
  }
}

module.exports = { DbTrustList }
