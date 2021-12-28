const Run = require('run-sdk')

const owner = 'cPepyUbXNEmJFqBcmrxFxuYr69v4Jn5qL9NtdA1wqch7GNZTBowE'
const purse = 'cVcVT1hpsJh5gvtgVWUH93HchkhtteHdWftqkzncwMtc1iXR7eU3'

const run = new Run({
  cache: new Run.plugins.LocalCache(),
  state: new Run.plugins.RunDB('http://localhost:3101'),
  network: 'test',
  owner,
  purse
})
run.trust('23c615454eaa787db6de70d1f61e8f1212c213278a4f6e031b9ca50010b8c283')
run.trust('8e76e558ea4e5383c22875d2eb442f9189cda9b60a187ec3cd307755903cda46')
run.blockchain.host = 'http://localhost:3000'

class AThing extends Run.Jig {
  init (initialThing) {
    this.thing = initialThing
  }

  change (newThing) {
    this.thing = newThing
  }
}

const main = async () => {
  // await run.transaction(() => {
  //   run.deploy(AThing)
  // })
  // await run.sync()
  // console.log(AThing.location)
  // const Klass = await run.load('8e76e558ea4e5383c22875d2eb442f9189cda9b60a187ec3cd307755903cda46_o1')
  // const instance = new Klass('a thing')
  // await instance.sync()
  // instance.change('shinier thing')
  // await instance.sync()
  // console.log(instance.location)
  const instance = await run.load('97b4149941677ba2da82de7c994dc7eb0d3fabef7efbf53ae9173dd592626d68_o1')
  await instance.sync()
  // instance.change('shinier thing' + instance.location)
  // await instance.sync()
  console.log(instance.location)
  console.log(instance.constructor.location)

  // console.log(await run.blockchain.utxos('n2nRMck2LEP7FBmWzWfS6T1EMzuSULnnsz'))
}

main()