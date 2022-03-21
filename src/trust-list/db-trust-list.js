class DbTrustList {
  async executionTrustList (ds) {
    return ds.searchAllTrust()
  }

  async checkExecutability (txid, ds) {
    return ds.txidTrustedAndReadyToExecute(txid)
  }

  async isTrusted (txid, ds) {
    return ds.isTrusted(txid)
  }

  async trust (txid, ds) {
    if (await ds.isTrusted(txid)) return []

    const trusted = [txid]

    // Recursively trust code parents
    const queue = await ds.getNonExecutedUpstreamTxIds(txid)
    const visited = new Set()
    while (queue.length) {
      const uptxid = queue.shift()
      if (visited.has(uptxid)) continue
      if (await ds.isTrusted(uptxid)) continue
      visited.add(uptxid)
      trusted.push(txid)
      const nextTxids = await ds.getNonExecutedUpstreamTxIds(uptxid)
      nextTxids.forEach(txid => queue.push(txid))
    }

    for (const trustedTxid of trusted) {
      await ds.setTrust(trustedTxid, true)
    }
    return trusted
  }

  async untrust (txid, ds) {
    await ds.setTrust(txid, false)
  }

  async missingTrustFor (txid, ds) {
    const txids = await ds.upstreamWithCode(txid)
    const result = []
    for (const currentTxid of [...txids, txid]) {
      const trusted = await this.isTrusted(currentTxid, ds)
      if (trusted) result.push(currentTxid)
    }
    return result
  }
}

module.exports = { DbTrustList }
