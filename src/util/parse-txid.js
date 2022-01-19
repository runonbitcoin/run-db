const parseTxid = (aString, ifNone) => {
  const txid = aString.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(txid)) { return ifNone(txid) }
  return txid
}

module.exports = { parseTxid }
