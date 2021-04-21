# RUN-DB

[![tests](https://github.com/runonbitcoin/run-db/workflows/tests/badge.svg)](https://github.com/runonbitcoin/run-db/actions) [![codecov](https://codecov.io/gh/runonbitcoin/run-db/branch/master/graph/badge.svg?token=auXAJR3INN)](https://codecov.io/gh/runonbitcoin/run-db)

![](demo.gif)

Crawls the blockchain and indexes RUN state.

Use RUN-DB to:
- Operate a State Server to improve RUN performance by pre-loading jigs
- Query balances, volume, history, and other information across many users and contracts
- Blacklist individual transactions and their descendants
- Create your own local database of transactions your app uses

## Requirements

Node 10+

## Getting started

1. Install `npm run install`
2. Download a db snapshot: `wget run.network/run-db-snapshots/latest/run.db` (*optional*)
3. Run `npm run start`
4. Install a trustlist: `curl -s https://api.run.network/v1/main/trust | curl -X POST -d @- http://localhost:8000/trust` (*optional*)

## Use with your Server

Setup your server's `Run` instance as follows:

```javascript
const client = true
const cache = new Run.plugins.RunDB('http://localhost:8000')
const trust = ['cache']
const run = new Run({ client, cache, trust })
```

Client mode makes RUN-DB the source of truth for your server. RUN will not load jigs that are not in your database, and your inventory will only be populated by jig UTXOs known to your database.

Setting trust to `'cache'` makes RUN use your database for its trustlist too. This means you only have to setup trust in one place using:

```
curl -X POST localhost:8000/trust/<txid>
```

## Use with a Browser or Mobile Client

The same approach taken for servers can be used to improve performance of client `Run` instances. You should expose your RUN-DB endpoints on a public or private domain rather than connect to `localhost`. If your client connections are not authenticated, be sure to only expose the GET endpoints and never the POST or DELETE endpoints, and use HTTPS to prevent MITM attacks.

## Configuration

Create a .env file or set the following environment variables before running to configure the DB.

| Name | Description | Default |
| ---- | ----------- | ------- |
| **API**| mattercloud, planaria, or none | mattercloud
| **MATTERCLOUD_KEY** | Mattercloud API key | undefined
| **PLANARIA_TOKEN** | Planaria API key | undefined
| **NETWORK** | Bitcoin network (main or test) | main
| **DB** | Database file | run.db
| **PORT** | Port used for the REST server | randomly generated
| **WORKERS** | Number of threads used to index | 4
| **FETCH_LIMIT** | Number of parallel downloads | 20
| **START_HEIGHT** | Block height to start indexing | block shortly before sep 2020
| **TIMEOUT** | Network timeout in milliseconds | 10000
| **MEMPOOL_EXPIRATION** | Seconds until transactions are removed from the mempool | 86400

## Endpoints

* `GET /jig/:location` - Gets the state for a jig at a particular location
* `GET /berry/:location` - Gets the state for a berry at a particular location
* `GET /tx/:txid` - Gets the raw transaction hex for an added transaction
* `GET /time/:txid` - Gets the block or mempool time of a transaction in seconds since unix epoch
* `GET /spends/:location` - Gets the spending txid for an output at a particular location
* `GET /unspent` - Gets the locations of all unspent jigs that are trusted. You may optionally pass in the following query params: `class` to filter by contract origin, `address` to filter by owner address, `pubkey` to filter by owner pubkey, `scripthash` to filter by hash of the owner script, `lock` to filter by lock class origin.
* `GET /trust/:txid?` - Gets whether a particular txid is trusted, or the entire trust list
* `GET /ban/:txid?` - Gets whether a particular txid is banned, or the entire ban list
* `GET /untrusted/:txid?` - Prints all txids that are not yet trusted, either globally or for a particular tx
* `GET /status` - Prints status information

* `POST /trust/:txid?` - Trusts a transaction to execute its code, as well as any untrusted ancestors. To trust multiple transactions at once, you may add an array of txids in the body as application/json.
* `POST /ban/:txid` - Bans a transaction from being executed, and unindexes it and its descendents
* `POST /tx/:txid?` - Indexes a transaction and any ancestors. You may optionally add the raw hex data for the transaction in the body as text/plain.

* `DELETE /trust/:txid` - Removes trust for a transaction, and unindexes it and its descendents
* `DELETE /ban/:txid` - Removes a transaction ban, and reindexes it and its descendents
* `DELETE /tx/:txid` - Removes a transaction, its descendents, and any connected state

## Performing Custom Queries

RUN-DB uses SQLite as its underlying database. SQLite allows multiple connections to the database so long as there is only one writer, which should be RUN-DB. You can open a read-only connection to the SQLite database to access these tables while RUN-DB is running, but be prepared to retry if you see SQLITE_BUSY errors. Alternatively, forking RUN-DB to create new endpoints for your application may be simpler.

### Example Queries

For some of these queries, you will need the [JSON1](https://www.sqlite.org/json1.html) SQLite extension.

#### Calculate SHUA supply

```
SELECT SUM(amount) as supply
FROM (
    SELECT
        json_extract(jig.state, '$.props.amount') AS amount
    FROM jig JOIN spends ON jig.location = spends.location
    WHERE spends.spend_txid IS NULL
    AND jig.class = 'ce8629aa37a1777d6aa64d0d33cd739fd4e231dc85cfe2f9368473ab09078b78_o1')
```

#### Calculate SHUA token balances by owner

```
SELECT owner, SUM(amount) as amount
FROM (SELECT
        json_extract(jig.state, '$.props.owner') AS owner,
        json_extract(jig.state, '$.props.amount') AS amount
    FROM jig JOIN spends ON jig.location = spends.location
    WHERE spends.spend_txid IS NULL
    AND jig.class = 'ce8629aa37a1777d6aa64d0d33cd739fd4e231dc85cfe2f9368473ab09078b78_o1')
GROUP BY owner
ORDER BY amount DESC
```

#### Re-execute all transactions

```
UPDATE tx SET executed = 0; DELETE FROM jig; DELETE FROM berry;
```

### Database Schema

There are currently 8 tables updated by RUN-DB.

#### jig

Stores jig and code states at output locations or destroyed locations.

| Column | Type | Description |
| ------ | ---- | ----------- |
| location | TEXT | Jig or code location |
| state | TEXT | JSON string describing the object state |
| class | TEXT | Contract origin if this state is a jig |
| scripthash | TEXT | Hex string of the reversed sha256 of the owner script |
| lock | TEXT | Lock class origin if this state has a custom lock |

#### tx

Stores all transactions known by RUN-DB and their indexing state.

| Column | Type | Description |
| ------ | ---- | ----------- |
| txid | TEXT | Hex string for the transaction hash |
| height | INTEGER | Block height for this transaction, or `-1` for mempool, or `NULL` for unknown |
| time | INTEGER | Transaction or bock time in seconds since the unix epoch |
| hex | TEXT | Raw transaction data in hex, or `NULL` if not downloaded |
| has_code | INTEGER | `1` if this transaction deployed or upgraded code and requires trust, `0` otherwise |
| executable | INTEGER | `1` if this transaction is a valid RUN transaction, `0` otherwise |
| executed | INTEGER | `1` if this transaction was executed, even if it failed, `0` otherwise |
| indexed | INTEGER | `1` if this transaction's jig states were calculated successfully, `0` otherwise |

#### spends

Stores spend information about transaction outputs.

| Column | Type | Description |
| ------ | ---- | ----------- |
| location | TEXT | \<txid\>_o\<output-index\> string describing an output
| spend_txid| TXID | Hex txid that spent this output, or `NULL` if unspent

#### deps

Stores the transaction needed to load a RUN transaction.

| Column | Type | Description |
| ------ | ---- | ----------- |
| up | TEXT | A transaction ID in hex |
| down | TEXT | Hex txid for a transaction that depends on `up` |

#### berry

Stores berry states for third-party protocol data.

| Column | Type | Description |
| ------ | ---- | ----------- |
| location | TEXT | Berry location without the &hash query param |
| state | TEXT | JSON string describing the object state |

#### trust

Stores the transactions which have been trusted and whose code will be executed.

| Column | Type | Description |
| ------ | ---- | ----------- |
| txid | TEXT | Hex string txid |
| value | INTEGER | `1` if trusted, `0` if untrusted |

#### ban

Stores the transactions which have been blacklisted.

| Column | Type | Description |
| ------ | ---- | ----------- |
| txid | TEXT | Hex string txid |
| value | INTEGER | `1` if blacklisted, `0` otherwise |

#### crawl

Stores the blockchain crawl height for data in the database.

| Column | Type | Description |
| ------ | ---- | ----------- |
| role | TEXT | Always `tip` |
| height | INTEGER | Block height currently indexed |
| hash | TEXT | Block hash currently indexed in hex |
