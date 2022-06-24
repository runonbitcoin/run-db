const { instance } = require('../../src/threading/parent-process')

const main = async () => {
  await instance.setUp()
}

main()
