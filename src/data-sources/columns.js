const TX = {
  NAME: 'tx',
  txid: 'txid',
  bytes: 'bytes',
  height: 'height',
  time: 'time',
  indexed: 'indexed',
  executable: 'executable',
  hasCode: 'has_code',
  executed: 'executed'
}

const DEPS = {
  NAME: 'deps',
  up: 'up',
  down: 'down'
}

const EXECUTING = {
  NAME: 'executing',
  txid: 'txid'
}

const TRUST = {
  NAME: 'trust',
  txid: 'txid',
  value: 'value'
}

const BAN = {
  NAME: 'ban',
  txid: 'txid'
}

const SPEND = {
  NAME: 'spends',
  location: 'location',
  spendTxid: 'spend_txid'
}

const JIG = {
  NAME: 'jig',
  location: 'location',
  state: 'state',
  klass: 'class',
  lock: 'lock',
  scriptHash: 'scriptHash'
}

const BERRY = {
  NAME: 'berry',
  location: 'location',
  state: 'state'
}

const CRAWL = {
  NAME: 'crawl',
  name: 'key',
  value: 'value'
}

module.exports = {
  TX,
  DEPS,
  EXECUTING,
  TRUST,
  BAN,
  SPEND,
  JIG,
  BERRY,
  CRAWL
}
