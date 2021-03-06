# Run DB

![](demo.gif)

Crawls the blockchain and indexes Run state.

## Getting started

Run `npm run start`

## Requirements

Node 12

## Configuration

Create a .env file or set the following environment variables to configure the DB.

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
* `GET /jigs` - Get a list of jigs. Optionally pass in the following query params: `orgin` to filter by contract origin, `unspent` to filter by unspent, `lock` to filter by lock orgin, `owner` to filter by owner.
* `GET /berry/:location` - Gets the state for a berry at a particular location
* `GET /tx/:txid` - Gets the raw transaction hex for an added transaction
* `GET /time/:txid` - Gets the block or mempool time of a transaction in seconds since unix epoch
* `GET /spends/:location` - Gets the spending txid for a jig at a particular location
* `GET /unspent` - Gets the locations of all unspent jigs that are trusted. You may optionally pass in the following query params: `class` to filter by contract origin.
* `GET /trust/:txid?` - Gets whether a particular txid is trusted, or the entire trust list
* `GET /ban/:txid?` - Gets whether a particular txid is banned, or the entire ban list
* `GET /untrusted/:txid?` - Prints all txids that are not yet trusted, either globally or for a particular tx
* `GET /status` - Prints status information

* `POST /trust/:txid` - Trusts a transaction to execute its code, as well as any untrusted ancestors
* `POST /ban/:txid` - Bans a transaction from being executed, and unindexes it and its descendents
* `POST /tx/:txid?` - Indexes a transaction and any ancestors. You may optionally add the raw hex data for the transaction in the body as text/plain.

* `DELETE /trust/:txid` - Removes trust for a transaction, and unindexes it and its descendents
* `DELETE /ban/:txid` - Removes a transaction ban, and reindexes it and its descendents
* `DELETE /tx/:txid` - Removes a transaction, its descendents, and any connected state
