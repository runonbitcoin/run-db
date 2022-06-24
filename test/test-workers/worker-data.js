const { instance, workerData } = require('../../src/threading/parent-process')

const main = async () => {
  instance.subscribe('data', async () => {
    return workerData
  })
  await instance.setUp()
}

main()
