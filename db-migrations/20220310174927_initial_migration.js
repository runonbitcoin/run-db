exports.up = async (knex) => {
  await knex.schema.createTable('spends', t => {
    t.text('location').notNullable().primary()
    t.text('spend_txid')
  })

  await knex.schema.createTable('deps', t => {
    t.bigIncrements().primary()
    t.text('up').notNullable()
    t.text('down').notNullable()
    t.unique(['up', 'down'])
    t.index(['up'], 'deps_up_index')
    t.index(['down'], 'deps_down_index')
  })

  await knex.schema.createTable('jig', t => {
    t.text('location').notNullable().primary()
    t.jsonb('state')
    t.text('class')
    t.text('scripthash')
    t.text('lock')
    t.index(['class'], 'jig_index')
  })

  await knex.schema.createTable('berry', t => {
    t.text('location').notNullable().primary()
    t.jsonb('state').notNullable()
    t.text('class')
    t.text('scripthash')
    t.text('lock')
  })

  await knex.schema.createTable('trust', t => {
    t.text('txid').notNullable().primary()
    t.boolean('value').notNullable()
    t.index(['txid'], 'trust_txid_index')
  })

  await knex.schema.createTable('ban', t => {
    t.text('txid').notNullable().primary()
    t.index(['txid'], 'ban_txid_index')
  })

  await knex.schema.createTable('tx', t => {
    t.text('txid').notNullable().primary()
    t.integer('height')
    t.timestamp('time')
    t.binary('bytes')
    t.boolean('has_code')
    t.boolean('executable')
    t.boolean('executed')
    t.boolean('indexed')
    t.index(['txid'], 'tx_txid_index')
    t.index(['height'], 'tx_height_index')
  })

  await knex.schema.createTable('crawl', t => {
    t.text('key').unique().notNullable().primary()
    t.text('value').notNullable()
  })

  await knex.schema.createTable('executing', t => {
    t.text('txid').notNullable().unique().primary()
  })
}

exports.down = async (knex) => {
  await knex.schema.dropTable('spends')
  await knex.schema.dropTable('deps')
  await knex.schema.dropTable('jig')
  await knex.schema.dropTable('berry')
  await knex.schema.dropTable('trust')
  await knex.schema.dropTable('ban')
  await knex.schema.dropTable('tx')
  await knex.schema.dropTable('crawl')
  await knex.schema.dropTable('executing')
}
