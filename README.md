# Run DB

![](demo.gif)

Crawls the blockchain and indexes Run state.

## Getting started

Run `npm run start`

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
* `GET /berry/:location` - Gets the state for a berry at a particular location
* `GET /tx/:txid` - Gets the raw transaction hex for an added transaction
* `GET /time/:txid` - Gets the block or mempool time of a transaction in seconds since unix epoch
* `GET /trust/:txid?` - Gets whether a particular txid is trusted, or the entire trust list
* `GET /untrusted/:txid?` - Prints all txids that are not yet trusted, either globally or for a particular tx
* `GET /status` - Prints status information

* `POST /trust/:txid` - Trusts a transaction to execute its code, as well as any untrusted ancestors
* `POST /tx/:txid` - Indexes a transaction and any ancestors. You may optionally add the `hex` query param.

* `DELETE /trust/:txid` - Removes trust for a transaction
* `DELETE /tx/:txid` - Removes a transaction, its descendants, and any connected state
