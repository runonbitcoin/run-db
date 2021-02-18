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

## Endpoints

* `/add/:txid` - Indexes a transaction. You may optionally add the `hex` query param.
* `/remove/:txid` - Removes a transaction and connected state
* `/jig/:location` - Gets the state for a jig at a particular location
* `/berry/:location` - Gets the state for a berry at a particular location
* `/tx/:txid` - Gets the raw transaction hex for an added transaction
* `/trust/:txid` - Trusts code in a transaction
* `/untrusted` - Prints all txids that are not yet trusted
