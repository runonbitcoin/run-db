class DepNotFound extends Error {
  constructor (type, id, txid) {
    super(`$dep not found [${type}]: ${id}`)
    this.type = type
    this.id = id
    this.txid = txid
  }
}

module.exports = { DepNotFound }
