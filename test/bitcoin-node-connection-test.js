const { describe, it, beforeEach } = require('mocha')
const { expect } = require('chai')
require('chai').use(require('chai-as-promised'))
const BitcoinNodeConnection = require('../src/bitcoin-node-connection')
const bsv = require('bsv')
const Run = require('run-sdk')

class TestBitcoinRpc {
  constructor () {
    this.knownTxs = new Map()
    this.unconfirmedTxs = []
    this.blocks = [
      {
        height: 1000,
        hash: Buffer.alloc(32).fill(1).toString('hex'),
        time: new Date().getTime(),
        txs: [],
        hex: buildBlock([], Buffer.alloc(32).fill(1))
      }
    ]
    this.nextBlockHeight = 1001
  }

  async getRawTransaction (txid, verbose = true) {
    if (verbose) {
      return this.knownTxs.get(txid)
    } else {
      return this.knownTxs.get(txid).hex
    }
  }

  async getBlockCount () {
    return this.blocks[this.blocks.length - 1].height
  }

  async getBlockByHeight (targetHeight, verbose) {
    const block = this.blocks.find(block => block.height === targetHeight)
    if (!verbose) {
      return block.hex
    } else {
      return {
        size: block.size || block.hex.length,
        previousblockhash: block.previousblockhash,
        tx: block.txs.map(tx => tx.hash)
      }
    }
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

  closeBlock (size = null) {
    const blockTime = new Date().getTime()
    const previousBlock = this.blocks[this.blocks.length - 1]
    const blockData = {
      height: this.nextBlockHeight,
      hash: null,
      time: blockTime,
      previousblockhash: previousBlock.hash,
      txs: []
    }

    if (size !== null) {
      blockData.size = size
    }

    this.nextBlockHeight = this.nextBlockHeight + 1
    while (this.unconfirmedTxs.length > 0) {
      const { txid, hex } = this.unconfirmedTxs.pop()
      const tx = {
        txid,
        hex,
        blockheight: blockData.height,
        blocktime: blockData.time
      }
      this.knownTxs.set(txid, tx)
      blockData.txs.push(new bsv.Transaction(tx.hex))
    }
    const bsvBlock = buildBlock(blockData.txs, blockData.previousblockhash)
    this.blocks.push({
      ...blockData,
      hex: bsvBlock.toBuffer().toString('hex'),
      hash: bsvBlock.hash
    })
  }
}

class TestZmq {
  constructor () {
    this.handler = null
    this.pendingTxs = []
  }

  subscribeRawTx (handler) {
    this.handler = handler
  }

  // test

  publishTx (tx) {
    this.pendingTxs.push(tx)
  }

  async processPendingTxs () {
    for (const tx of this.pendingTxs) {
      await this.handler(tx.toBuffer().toString('hex'))
    }
  }
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

const buildRandomRunTx = async (run) => {
  class Foo extends Run.Jig {
    init (attr) {
      this.attr = attr
    }
  }

  const tx = new Run.Transaction()

  const FooDeployed = tx.update(() => run.deploy(Foo))
  tx.update(() => new FooDeployed(Math.random()))

  return new bsv.Transaction(await tx.export())
}

const buildBlock = (transactions, prevHash = Buffer.alloc(32).fill('1'), hash) => {
  const block = bsv.Block.fromObject({
    transactions,
    header: {
      hash,
      prevHash: prevHash,
      merkleRoot: Buffer.alloc(32).fill('2')
    }
  })

  return block
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
  let run = null

  beforeEach(() => {
    bitcoinZmq = new TestZmq()
    bitcoinRpc = new TestBitcoinRpc()
    instance = new BitcoinNodeConnection(bitcoinZmq, bitcoinRpc)

    run = new Run({
      purse: {
        pay: (rawtx) => rawtx
      }
    })
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
      const lastBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 1]
      const nextBlock = await instance.getNextBlock(lastBlock.height, bitcoinRpc.currentBlockHash)
      expect(nextBlock).to.equal(null)
    })

    it('returns block 1001 if 1000 was sent as parameter with the right hash', async () => {
      const randomTx = buildRandomTx()
      bitcoinRpc.registerUnconfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))
      bitcoinRpc.closeBlock()
      const previousBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 2]
      const lastBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 1]

      const nextBlock = await instance.getNextBlock(previousBlock.height, previousBlock.hash)
      expect(nextBlock.height).to.equal(lastBlock.height)
    })

    it('returns a block with correct attributes', async () => {
      const randomTx = await buildRandomRunTx(run)
      bitcoinRpc.registerUnconfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))
      bitcoinRpc.closeBlock()
      const previousBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 2]
      const lastBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 1]

      const nextBlock = await instance.getNextBlock(previousBlock.height, previousBlock.hash)
      expect(Object.keys(nextBlock).length).to.eql(4)
      expect(nextBlock.height).to.equal(lastBlock.height)
      expect(nextBlock.hash).to.equal(lastBlock.hash)
      expect(nextBlock.txids).to.eql([randomTx.hash])
      expect(nextBlock.txhexs).to.eql([randomTx.toBuffer().toString('hex')])
    })

    it('correct block when tons of blocks exists', async () => {
      const randomTx = await buildRandomRunTx(run)
      bitcoinRpc.registerUnconfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))
      bitcoinRpc.closeBlock()
      bitcoinRpc.closeBlock()
      bitcoinRpc.closeBlock()
      bitcoinRpc.closeBlock()
      const firstBlock = bitcoinRpc.blocks[0]
      const secondBlock = bitcoinRpc.blocks[1]

      const nextBlock = await instance.getNextBlock(firstBlock.height, null)
      expect(Object.keys(nextBlock).length).to.eql(4)
      expect(nextBlock.height).to.equal(secondBlock.height)
    })

    it('returns reorg when the hash of the previous block doesnt match', async () => {
      const randomTx = buildRandomTx()
      bitcoinRpc.registerUnconfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))
      bitcoinRpc.closeBlock()
      const previousBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 2]

      const nextBlock = await instance.getNextBlock(previousBlock.height, 'wronghash')
      expect(nextBlock).to.eql({ reorg: true })
    })

    it('does not returns reorg if the prev hash was null', async () => {
      const randomTx = buildRandomTx()
      bitcoinRpc.registerUnconfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))
      bitcoinRpc.closeBlock()
      const previousBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 2]
      const lastBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 1]

      const nextBlock = await instance.getNextBlock(previousBlock.height, null)
      expect(nextBlock.hash).to.eql(lastBlock.hash)
    })

    it('only includes txids of run txs', async () => {
      const randomTx = buildRandomTx()
      const randomRunTx = await buildRandomRunTx(run)
      bitcoinRpc.registerUnconfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))
      bitcoinRpc.registerUnconfirmedTx(randomRunTx.hash, randomRunTx.toBuffer().toString('hex'))
      bitcoinRpc.closeBlock()
      const previousBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 2]

      const nextBlock = await instance.getNextBlock(previousBlock.height, null)
      expect(nextBlock.txids).to.eql([randomRunTx.hash])
    })

    it('trows error if block height is longer than the latest block', () => {
      const lastBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 1]
      expect(instance.getNextBlock(lastBlock.height + 1, null)).to.eventually.throw()
    })

    it('trows error if block height is negative than the latest block', () => {
      expect(instance.getNextBlock(-1, null)).to.eventually.throw()
    })

    it('does not process txs with invalid outputs for bsv1.x', async () => {
      const tx = bsv.Transaction()
        .from({
          txId: Buffer.alloc(32).fill(1).toString('hex'),
          outputIndex: 0,
          script: bsv.Script.fromASM('0 0'),
          satoshis: 20005
        })
        .to(bsv.Address.fromPrivateKey(bsv.PrivateKey.fromRandom()), 1000)
        .addOutput(new bsv.Transaction.Output({ satoshis: 600, script: Buffer.from('6a304502204b13f000b2f046a17fe77976ad4bc6c6055194745b434757eef9faf8bc5de9a8022100b1c2fdce9df149cc8de3dda5ea680dab46888d28abca9b8abac7a8d6d37e4e6a', 'hex') }))

      bitcoinRpc.registerUnconfirmedTx(tx.hash, tx.toBuffer().toString('hex'))
      bitcoinRpc.closeBlock()
      const previousBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 2]
      const nextBlock = await instance.getNextBlock(previousBlock.height, null)
      expect(nextBlock.txids).to.eql([])
    })

    it('does not consider outptus with less than 4 chunks', async () => {
      const tx = bsv.Transaction()
        .from({
          txId: Buffer.alloc(32).fill(1).toString('hex'),
          outputIndex: 0,
          script: bsv.Script.fromASM('0 0'),
          satoshis: 20005
        })
        .to(bsv.Address.fromPrivateKey(bsv.PrivateKey.fromRandom()), 1000)
        .addOutput(new bsv.Transaction.Output({ satoshis: 600, script: Buffer.from('51', 'hex') })) // >> OP_TRUE

      bitcoinRpc.registerUnconfirmedTx(tx.hash, tx.toBuffer().toString('hex'))
      bitcoinRpc.closeBlock()
      const previousBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 2]
      const nextBlock = await instance.getNextBlock(previousBlock.height, null)
      expect(nextBlock.txids).to.eql([])
    })

    it('works for giant blocks', async () => {
      const randomTx = buildRandomTx()
      const randomRunTx = await buildRandomRunTx(run)
      bitcoinRpc.registerUnconfirmedTx(randomTx.hash, randomTx.toBuffer().toString('hex'))
      bitcoinRpc.registerUnconfirmedTx(randomRunTx.hash, randomRunTx.toBuffer().toString('hex'))
      bitcoinRpc.closeBlock(0x1fffffe8 + 1)
      const previousBlock = bitcoinRpc.blocks[bitcoinRpc.blocks.length - 2]

      const nextBlock = await instance.getNextBlock(previousBlock.height, null)
      expect(nextBlock.txids).to.eql([randomRunTx.hash])
    })
  })

  describe('#listenForMempool', () => {
    it('calls the handler if the tx is run related', async () => {
      let called = false
      const handler = async () => {
        called = true
      }

      await instance.listenForMempool(handler)

      const randomTx = await buildRandomRunTx(run)

      bitcoinZmq.publishTx(randomTx)
      await bitcoinZmq.processPendingTxs()

      expect(called).to.equal(true)
    })

    it('does not calls the handler if the tx is not run related', async () => {
      let called = false
      const handler = async () => {
        called = true
      }

      await instance.listenForMempool(handler)

      const randomTx = buildRandomTx()

      bitcoinZmq.publishTx(randomTx)
      await bitcoinZmq.processPendingTxs()

      expect(called).to.equal(false)
    })

    it('the handler receives the right parameters', async () => {
      const randomTx = await buildRandomRunTx(run)

      const handler = async (txid, txHex) => {
        expect(txid).to.eql(randomTx.hash)
        expect(txHex).to.eql(randomTx.toBuffer().toString('hex'))
      }

      await instance.listenForMempool(handler)

      bitcoinZmq.publishTx(randomTx)
      await bitcoinZmq.processPendingTxs()
    })
  })

  describe('buildBlock', () => {
    it('returns a parseable block', () => {
      const hexBlock = buildBlock([buildRandomTx()]).toBuffer().toString('hex')
      expect(() => new bsv.Block(Buffer.from(hexBlock, 'hex'))).not.to.throw()
    })

    it('returns a block with correct previous hash', () => {
      const prevHash = Buffer.alloc(32).fill('6').toString('hex')
      const block = buildBlock([buildRandomTx()], prevHash)
      expect(block.header.prevHash.reverse().toString('hex')).to.eql(prevHash)
    })
  })
})
