const knex = require('knex')
const { expect } = require('chai')
const { TX, DEPS, TRUST } = require('../src/data-sources/columns')

describe('knex queries', () => {
  let db
  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: {
        filename: ':memory:'
      },
      migrations: {
        directory: 'db-migrations'
      }
    })

    await db.migrate.latest()
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('can insert', async () => {
    await db('ban').insert({ txid: 'sometxid' })
  })

  it('exists after insert', async () => {
    const txid = 'sometxid'
    const beforeResponse = await db('ban').where({ txid }).first()
    expect(beforeResponse).to.eql(undefined)
    await db('ban').insert({ txid: txid })
    const afterReponse = await db('ban').where({ txid }).first()
    expect(afterReponse.txid).to.eql(txid)
  })

  it('can check if exists with query builder', async () => {
    const txid = 'sometxid'
    await db('ban').insert({ txid: txid })

    const result = await db('ban').where(qb => {
      qb.where('txid', txid)
    }).first()
    expect(result.txid).to.eql(txid)
  })

  it('first can retrieve only one column', async () => {
    const txid1 = 'sometxid'
    const txid2 = 'anothertxid'
    await db('deps').insert({ up: txid1, down: txid2 })

    const result = await db('deps').where(qb => {
      qb.where('up', txid1)
    }).first(['up'])
    expect(result.up).to.eql(txid1)
  })

  it('selects returns all', async () => {
    const txid1 = 'sometxid1'
    const txid2 = 'sometxid2'
    const txid3 = 'sometxid3'
    await db('ban').insert({ txid: txid1 })
    await db('ban').insert({ txid: txid2 })
    await db('ban').insert({ txid: txid3 })

    const bans = await db('ban').select()

    expect(bans.map(b => b.txid)).to.have.members([txid1, txid2, txid3])
  })

  it('can count', async () => {
    const txid1 = 'sometxid1'
    const txid2 = 'sometxid2'
    const txid3 = 'sometxid3'

    await db('tx').insert({ txid: txid1 })
    await db('tx').insert({ txid: txid2, bytes: Buffer.from(txid1) })
    await db('tx').insert({ txid: txid3, bytes: Buffer.from(txid2) })

    const result = await db(TX.NAME).whereNotNull(TX.bytes).count(TX.txid, { as: 'count' }).first()
    expect(result.count).to.eql(2)
  })

  describe('count failed deps query', () => {
    it('compiles', async () => {
      const txid = 'sometxid`'
      const result = await db(TX.NAME)
        .join(DEPS.NAME, `${DEPS.NAME}.${DEPS.up}`, `${TX.NAME}.${TX.txid}`)
        .join({ innerTx: TX.NAME }, `${DEPS.NAME}.${DEPS.down}`, `innerTx.${TX.txid}`)
        .where(`${TX.NAME}.${TX.txid}`, txid)
        .where(`innerTx.${TX.executed}`, true)
        .where(`innerTx.${TX.indexed}`, false)
        .count(`${TX.NAME}.${TX.txid}`, { as: 'count' })
        .first()

      expect(result.count).to.eql(0)
    })
  })

  describe('trust and ready query', () => {
    it('compiles', async () => {
      const query = db(TX.NAME)
        .whereNotNull(TX.bytes)
        .andWhere(TX.executable, true)
        .andWhere(TX.executed, false)
        .andWhere(qb => {
          qb.where(TX.hasCode, false).orWhereExists(function () {
            this.select(TRUST.txid).from(TRUST.NAME).whereRaw(`${TRUST.txid} = ${TX.NAME}.${TX.txid}`).andWhere(TRUST.value, true)
          })
        })
        .andWhere(qb => {
          qb.whereNotExists(function () {
            this.select('txid')
              .from({ otherTx: TX.NAME })
              .join(DEPS.NAME, `${DEPS.NAME}.${DEPS.down}`, `${TX.NAME}.${TX.txid}`)
              .join({ innerTx: TX.NAME }, `${DEPS.NAME}.${DEPS.up}`, `innerTx.${TX.txid}`)
            this.whereNotNull(`innerTx.${TX.bytes}`)
              .andWhere(`innerTX.${TX.executable}`, true)
              .andWhereNot(qb2 => {
                qb2.where(`innerTx.${TX.executable}`, true).andWhere(`innerTx.${TX.executed}`)
              })
          })
        })

      console.log(query.toString())
      await query
    })
  })
})
