const { instance } = require('../../src/threading/parent-process')

const main = async () => {
  instance.subscribe('send', async ({ topic, body }) => {
    await instance.send(topic, body)
  })
  await instance.setUp()
}

main()
