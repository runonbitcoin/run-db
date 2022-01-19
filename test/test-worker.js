const Bus = require('../src/bus')
const { parentPort } = require('worker_threads')

const execute = (...params) => {
  return { solution: 42, params }
}

Bus.listen(parentPort, { execute })
