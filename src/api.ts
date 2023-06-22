/**
 * api.ts
 *
 * API used to get transaction data
 */

// ------------------------------------------------------------------------------------------------
// Api
// ------------------------------------------------------------------------------------------------

import { Logger } from './logger'

abstract class AbstractApi {
  // Connect to the API at a particular block height and network
  abstract connect(height: number, network: string): Promise<void>

  // Stop any connections
  abstract disconnect(): Promise<void>

  // Returns the rawtx of the txid, or throws an error
  abstract fetch(txid: string): Promise<Transaction>

  // Gets the next relevant block of transactions to add
  // currHash may be null
  // If there is a next block, return: { height, hash, txids, txhexs? }
  // If there is no next block yet, return null
  // If the current block passed was reorged, return { reorg: true }
  abstract getNextBlock(currentHeight: number, currentHash: string): Promise<NextBlock | Reorg | null>

  // Begins listening for mempool transactions
  // The callback should be called with txid and optionally rawtx when mempool tx is found
  // The crawler will call this after the block syncing is up-to-date.
  abstract listenForMempool (mempoolTxCallback: Function): Promise<void>
}

export default abstract class Api extends AbstractApi {

  logger: Logger;

}

// ------------------------------------------------------------------------------------------------

export interface NextBlock {
  height: number;
  hash: string;
  txids: string[];
  txhexs?: string[];
}

interface Reorg {
  reorg: boolean;
}

export interface Transaction {
  txid?: string;
  hash?: string;
  hex: string;
  height: number | null;
  time: number;
}


