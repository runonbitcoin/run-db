const RAW_TXS_T = 'raw_transactions'
const JIG_STATES_T = 'jig_states'

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.schema.createTable(RAW_TXS_T, t => {
    t.text('txid').notNullable().primary()
    t.binary('bytes').notNullable()
  })

  await knex.schema.createTable(JIG_STATES_T, t => {
    t.text('location').notNullable().primary()
    t.jsonb('state').notNullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.schema.dropTable('raw_transactions')
  await knex.schema.dropTable(JIG_STATES_T)
}
