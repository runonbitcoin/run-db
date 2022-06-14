const Run = require('run-sdk')

const buildTxSize = () => {
  class TxSize extends Run.Berry {
    static async pluck (location, fetch) {
      const hex = await fetch(location)
      return new this(hex.length)
    }

    init (size) {
      this.size = size
    }
  }

  return TxSize
}

module.exports = { buildTxSize }
