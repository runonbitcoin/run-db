const { describe, it, beforeEach } = require('mocha')
const { expect } = require('chai')
require('chai').use(require('chai-as-promised'))
const BitcoinNodeConnection = require('../src/bitcoin-node-connection')
const bsv = require('bsv')

class TestBitcoinRpc {
  constructor () {
    this.knownTxs = new Map()
    this.unconfirmedTxs = []
    this.blocks = [
      {
        height: 1000,
        hash: 'athousend',
        time: new Date().getTime(),
        txs: []
      }
    ]
    this.nextBlockHeight = 1001
  }

  async getRawTransaction (txid) {
    return this.knownTxs.get(txid)
  }

  // Test

  registerConfirmedTx (txid, rawTx) {
    this.registerUnconfirmedTx(txid, rawTx)
    this.closeBlock(this.nextBlockHeight.toString())
  }

  registerUnconfirmedTx (txid, rawTx) {
    this.knownTxs.set(txid, {
      hex: rawTx
    })
    this.unconfirmedTxs.push({ txid, hex: rawTx })
  }

  closeBlock (blockHash, blockTime = new Date().getTime()) {
    const block = {
      height: this.nextBlockHeight,
      hash: blockHash,
      time: blockTime,
      txs: []
    }
    this.nextBlockHeight = this.nextBlockHeight + 1
    while (this.unconfirmedTxs.length > 0) {
      const { txid, hex } = this.unconfirmedTxs.pop()
      const tx = {
        txid,
        hex,
        blockheight: block.height,
        blocktime: block.time
      }
      this.knownTxs.set(txid, tx)
      block.txs.push(tx)
    }
    this.blocks.push(block)
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

  let bitcoinZmq = null
  let bitcoinRpc = null
  let instance = null

  beforeEach(() => {
    bitcoinZmq = new TestZmq()
    bitcoinRpc = new TestBitcoinRpc()
    instance = new BitcoinNodeConnection(bitcoinZmq, bitcoinRpc)
  })

  describe('#fetch', () => {
    it('returns the rawTx when the rawTx exists', async () => {
      const randomTx = buildRandomTx()
      bitcoinRpc.registerConfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))

      const resultTxHex = await instance.fetch(randomTx.hash)
      expect(resultTxHex.hex).to.eql(randomTx.toBuffer().toString('hex'))
    })

    it('returns the blocktime when the tx was confirmed', async () => {
      const randomTx = buildRandomTx()
      bitcoinRpc.registerConfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))

      const resultTxHex = await instance.fetch(randomTx.hash)
      const lastBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 1]
      expect(resultTxHex.time).to.eql(lastBlock.time)
    })

    it('returns the blockheight when the tx was confirmed', async () => {
      const randomTx = buildRandomTx()
      bitcoinRpc.registerConfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))

      const resultTxHex = await instance.fetch(randomTx.hash)
      const lastBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 1]
      expect(resultTxHex.height).to.eql(lastBlock.height)
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

  describe('#getNextBlock', () => {
    it('returns null if the height and the hash sent is the current one', async () => {
      const nextBlock = await instance.getNextBlock(bitcoinRpc.currentHeight, bitcoinRpc.currentBlockHash)
      expect(nextBlock).to.equal(null)
    })

    it('returns block 1001 if 1000 was sent as parameter with the right hash', async () => {
      const nextBlock = await instance.getNextBlock(bitcoinRpc.currentHeight, bitcoinRpc.currentBlockHash)
      expect(nextBlock).to.equal(null)
    })
  })
})
