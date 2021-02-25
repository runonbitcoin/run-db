# run-db

Crawls the blockchain and indexes Run state.

## Getting started

Run `npm run start`

## Configuration

Create a .env file or set the following environment variables to configure the DB.

| Name | Description | Default |
| ---- | ----------- | ------- |
| **API**| mattercloud, planaria, bitcoind, or none | mattercloud
| **MATTERCLOUD_KEY** | Mattercloud API key | undefined
| **PLANARIA_TOKEN** | Planaria API key | undefined
| **RPC_PORT** | RPC port for Bitcoin node | 8334 (mainnet) or 18334 (testnet)
| **RPC_USER** | RPC username | undefined
| **RPC_PASS** | RPC password | undefined
| **NETWORK** | Bitcoin network (main or test) | main
| **DB** | Database file | run.db
| **PORT** | Port used for the REST server | randomly generated
| **WORKERS** | Number of threads used to index | 4
| **FETCH_LIMIT** | Number of parallel downloads | 20
| **START_HEIGHT** | Block height to start indexing | block shortly before sep 2020
| **TIMEOUT** | Network timeout in milliseconds | 10000

## Endpoints

* `GET /jig/:location` - Gets the state for a jig at a particular location
* `GET /berry/:location` - Gets the state for a berry at a particular location
* `GET /tx/:txid` - Gets the raw transaction hex for an added transaction
* `GET /trust/:txid?` - Gets whether a particular txid is trusted, or the entire trust list
* `GET /untrusted/:txid?` - Prints all txids that are not yet trusted, either globally or for a particular tx
* `GET /status` - Prints status information

* `POST /trust/:txid` - Trusts code in a transaction
* `POST /tx/:txid` - Indexes a transaction. You may optionally add the `hex` query param.

* `DELETE /trust/:txid` - Removes trust for a transaction
* `DELETE /tx/:txid` - Removes a transaction and its connected state
