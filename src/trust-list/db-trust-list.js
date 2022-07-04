class DbTrustList {
  async executionTrustList (ds) {
    return ds.searchAllTrust()
  }

  async trustedToExecute (txid, ds) {
    const { tx, deps } = await ds.getTxAndDeps(txid)

    const txidsToCheck = [tx, ...deps]
      .filter(txMetadata => txMetadata.hasCode)
      .map(txMetadata => txMetadata.txid)

    return ds.allTrusted(txidsToCheck)
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

  async missingTrustFor (txid, ds, includeRoot) {
    const txids = await ds.upstreamWithCode(txid)
    const result = []
    const list = includeRoot ? [...txids, txid] : txids
    for (const currentTxid of list) {
      const trusted = await this.isTrusted(currentTxid, ds)
      if (!trusted) result.push(currentTxid)
    }
    return result
  }
}

module.exports = { DbTrustList }
