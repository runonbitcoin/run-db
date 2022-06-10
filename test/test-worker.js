const { instance } = require('../src/threading/parent-process')

const execute = (...params) => {
  if (params[0] === Buffer.alloc(32).fill(1).toString('hex')) {
    throw new Error('execution failed')
  }
  return { solution: 42, params }
}

instance.subscribe('execute', execute)
instance.setUp()
