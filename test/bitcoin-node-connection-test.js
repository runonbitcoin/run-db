const { describe, it, beforeEach } = require('mocha')
const { expect } = require('chai')
require('chai').use(require('chai-as-promised'))
const BitcoinNodeConnection = require('../src/bitcoin-node-connection')
const bsv = require('bsv')

class TestBitcoinRpc {
  constructor () {
    this.knownTxs = new Map()
    this.currentHeight = 1000
    this.currentBlockTime = new Date().getTime()
  }

  async getRawTransaction (txid) {
    return this.knownTxs.get(txid)
  }

  // Test

  registerConfirmedTx (txid, rawTx) {
    this.knownTxs.set(txid, {
      hex: rawTx,
      blockheight: this.currentHeight,
      blocktime: this.currentBlockTime
    })
  }

  registerUnconfirmedTx (txid, rawTx) {
    this.knownTxs.set(txid, {
      hex: rawTx
    })
  }
}

class TestZmq {

}

const buildRandomTx = () => {
  const tx = bsv.Transaction()
    .from({
      txId: Buffer.alloc(32).fill(1).toString('hex'),
      outputIndex: 0,
      script: bsv.Script.fromASM('0 0'),
      satoshis: 2000
    })
    .to(bsv.Address.fromPrivateKey(bsv.PrivateKey.fromRandom()), 1000)

  return tx
}

describe('BitcoinNodeConnection', () => {
  it('initializes', () => {
    const bitcoinZmq = new TestZmq()
    const bitcoinRpc = new TestBitcoinRpc()
    const instance = new BitcoinNodeConnection(bitcoinZmq, bitcoinRpc)
    expect(instance).not.to.equal(null)
  })

  describe('#fetch', () => {
    let bitcoinZmq = null
    let bitcoinRpc = null
    let instance = null
    beforeEach(() => {
      bitcoinZmq = new TestZmq()
      bitcoinRpc = new TestBitcoinRpc()
      instance = new BitcoinNodeConnection(bitcoinZmq, bitcoinRpc)
    })

    it('returns the rawTx when the rawTx exists', async () => {
      const randomTx = buildRandomTx()
      bitcoinRpc.registerConfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))

      const resultTxHex = await instance.fetch(randomTx.hash)
      expect(resultTxHex.hex).to.eql(randomTx.toBuffer().toString('hex'))
    })

    it('returns the blocktime and the blockheight when the tx was confirmed', async () => {
      const randomTx = buildRandomTx()
      bitcoinRpc.registerConfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))

      const resultTxHex = await instance.fetch(randomTx.hash)
      expect(resultTxHex.time).to.eql(bitcoinRpc.currentBlockTime)
      expect(resultTxHex.height).to.eql(bitcoinRpc.currentHeight)
    })

    it('returns the blocktime and the blockheight when the tx was confirmed', async () => {
      const randomTx = buildRandomTx()
      bitcoinRpc.registerConfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))

      const resultTxHex = await instance.fetch(randomTx.hash)
      expect(resultTxHex.time).to.eql(bitcoinRpc.currentBlockTime)
    })

    it('returns the blockheight when the tx was confirmed', async () => {
      const randomTx = buildRandomTx()
      bitcoinRpc.registerConfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))

      const resultTxHex = await instance.fetch(randomTx.hash)
      expect(resultTxHex.height).to.eql(bitcoinRpc.currentHeight)
    })

    it('returns -1 as blockheight when the tx was not confirmed', async () => {
      const randomTx = buildRandomTx()
      bitcoinRpc.registerUnconfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))

      const resultTxHex = await instance.fetch(randomTx.hash)
      expect(resultTxHex.height).to.eql(-1)
    })

    it('returns null as blocktime when the tx was not confirmed', async () => {
      const randomTx = buildRandomTx()
      bitcoinRpc.registerUnconfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))

      const resultTxHex = await instance.fetch(randomTx.hash)
      expect(resultTxHex.time).to.equal(null)
    })

    it('throws if the txid does not exist', async () => {
      const randomTx = buildRandomTx()
      // bitcoinRpc.registerUnconfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))

      expect(instance.fetch(randomTx.hash)).to.eventually.throw()
    })
  })
})
