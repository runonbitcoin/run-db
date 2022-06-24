const { instance } = require('../../src/threading/parent-process')

const main = async () => {
  instance.subscribe('ping', async () => {
    return { data: 'pong' }
  })
  await instance.setUp()
}

main()
