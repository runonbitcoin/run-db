const knex = require('knex')
const { expect } = require('chai')
const { TX, DEPS, TRUST, BAN, CRAWL } = require('../src/data-sources/columns')

describe('knex queries', () => {
  let db
  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: {
        filename: 'coso.sqlite3'
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

  it('can pluck', async () => {
    await db(TRUST.NAME).insert({ txid: 'a', value: true })
    await db(TRUST.NAME).insert({ txid: 'b', value: true })

    const txids = await db(TRUST.NAME).pluck(TX.txid)
    expect(txids).to.have.members(['a', 'b'])
  })

  describe('deps queries', () => {
    it('returns what expected', async () => {
      await db(DEPS.NAME).insert({ up: 'up', down: 'down' })
      const rows = await db(DEPS.NAME).where(DEPS.up, 'up').select([DEPS.down])
      expect(rows.map(r => r.down)).to.eql(['down'])
    })
  })

  describe('trust and ready query', () => {
    it('compiles', async () => {
      const mainTx = 'mainTx'
      const txid = 'aTxid'
      const query = db(db.ref(TX.NAME).as(mainTx))
        .join(TRUST.NAME, `${TRUST.NAME}.${TRUST.txid}`, `${mainTx}.${TX.txid}`)
        .leftJoin(BAN.NAME, `${BAN.NAME}.${BAN.txid}`, `${mainTx}.${TX.txid}`)
        .where(`${mainTx}.${TX.txid}`, txid)
        .where(`${mainTx}.${TX.executable}`, true)
        .where(`${mainTx}.${TX.executed}`, false)
        .where(qb => {
          qb.where(`${mainTx}.${TX.hasCode}`, false).orWhere(`${TRUST.NAME}.${TRUST.txid}`, true)
        })
        .whereNull(`${BAN.NAME}.${BAN.txid}`)
        .whereNotExists(function () {
          const depTx = 'depTx'
          this.select(TX.txid).from(db.ref(TX.NAME).as(depTx))
            .join(DEPS.NAME, DEPS.up, `${depTx}.${TX.txid}`)
            .where(DEPS.down, `${mainTx}.${TX.txid}`)
            .where(qb => {
              qb.whereNull(`${depTx}.${TX.bytes}`).orWhere(qb => {
                qb.where(`${depTx}.${TX.executable}`, true)
                qb.where(`${depTx}.${TX.executed}`, false)
              })
            })
        })
      console.log(query.toString())
      await query
    })

    it('compiles multiple', async () => {
      const txid = 'aaa'
      const knex = db
      const mainTx = 'mainTx'
      const rows = await knex(DEPS.NAME)
        .join(knex.ref(TX.NAME).as(mainTx), `${mainTx}.${TX.txid}`, `${DEPS.NAME}.${DEPS.down}`)
        .leftJoin(BAN.NAME, `${BAN.NAME}.${BAN.txid}`, `${mainTx}.${TX.txid}`)
        .leftJoin(TRUST.NAME, `${mainTx}.${TX.txid}`, `${TRUST.NAME}.${TRUST.txid}`)
        .whereNotNull(`${mainTx}.${TX.bytes}`)
        .where(`${mainTx}.${TX.txid}`, txid)
        .where(`${mainTx}.${TX.executable}`, true)
        .where(`${mainTx}.${TX.executed}`, false)
        .whereNull(`${BAN.NAME}.${BAN.txid}`)
        .where(qb => {
          qb.where(`${mainTx}.${TX.hasCode}`, false).orWhere(`${TRUST.NAME}.${TRUST.txid}`, true)
        })
        .whereNotExists(function () {
          const depTx = 'depTx'
          this.select(TX.txid).from(knex.ref(TX.NAME).as(depTx))
            .join(DEPS.NAME, DEPS.up, `${depTx}.${TX.txid}`)
            .where(DEPS.down, `${mainTx}.${TX.txid}`)
            .where(qb => {
              qb.whereNull(`${depTx}.${TX.bytes}`).orWhere(qb => {
                qb.where(`${depTx}.${TX.executable}`, true)
                qb.where(`${depTx}.${TX.executed}`, false)
              })
            })
        }).select([`${mainTx}.${TX.txid}`])
      expect(rows).to.eql([])
    })
  })

  it('coso', async () => {
    const coso = await db(CRAWL.NAME)
      .where(CRAWL.name, 'holu')
      .first()
    expect(coso).to.eql(undefined)
    // const a = await db.schema.hasColumn('crawl', 'value')
    // expect(a).to.eql(true)

    // expect(coso).to.eql(undefined)
  })
})
