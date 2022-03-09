const Bus = require('../src/bus')
const { parentPort } = require('worker_threads')

const execute = (...params) => {
  if (params[0] === Buffer.alloc(32).fill(1).toString('hex')) {
    throw new Error('execution failed')
  }
  return { solution: 42, params }
}

Bus.listen(parentPort, { execute })
