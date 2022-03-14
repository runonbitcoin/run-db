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

module.exports = {
  TX,
  DEPS,
  EXECUTING,
  TRUST
}
