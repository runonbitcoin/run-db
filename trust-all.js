const Sqlite3Database = require('better-sqlite3')
const axios = require('axios')

const main = async () => {
  const db = new Sqlite3Database('./run.db')
  const statement = db.prepare('select txid from tx where has_code = 1')
  const result = await statement.all()

  const txids = result.map(a => a.txid)

  axios.post('http://localhost:3500/trust', txids).then(() => console.log('todo piola'))
}

main()
