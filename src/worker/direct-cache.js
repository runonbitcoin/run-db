
const withTimeMeasure = async (label, fn, _logger) => {
  // const start = process.hrtime.bigint()
  // const result = await fn()
  // const end = process.hrtime.bigint()
  // const diff = end - start
  // logger(`[time] ${label}: ${Number(diff / 1000n) / 1000}ms`)
  // return result
  return await fn()
}

class DirectCache {
  constructor (blobStorage, logger) {
    this.blobs = blobStorage
    this.logger = logger
    this.state = {}
    this.newStates = {}
  }

  async get (key) {
    const value = this.state[key]
    if (value) { return value }

    const [type, identifier] = key.split('://')
    if (type === 'jig' || type === 'berry') {
      const jig = await withTimeMeasure(`fetch state ${identifier}`, async () => this.blobs.pullJigState(identifier, () => undefined), this.logger)
      this.state[key] = jig
      return jig
    } else if (type === 'tx') {
      const rawTx = await withTimeMeasure(`fetch rawtx ${identifier}`, async () => this.blobs.pullTx(identifier, () => null), this.logger)
      if (rawTx !== null) {
        const txHex = rawTx.toString('hex')
        this.state[key] = txHex
        return txHex
      }
    } else {
      return null
    }
  }

  async set (key, value) {
    const existedBefore = !!this.state[key]
    this.state[key] = value
    if (key.startsWith('jig://') || key.startsWith('berry://')) {
      this.newStates[key] = value
    }

    if (existedBefore) {
      return null
    }

    const [type, identifier] = key.split('://')
    if (type === 'jig' || type === 'berry') {
      await this.blobs.pushJigState(identifier, value)
    }
  }
}

module.exports = { DirectCache }