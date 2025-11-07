

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getWalletTokenBalance } from './tools/getWalletTokenBalance';
import { getWalletTokenTransactions } from './tools/getWalletTokenTransactions';
import { whaleTracker } from './tools/whaleTracker';
import { transactionTracker } from './tools/transactionTracker';
// import { newsTracker } from './tools/newsTracker';
import { tokenAnalyzer } from './tools/tokenAnalyzer';
import { getNFTByWallet } from './tools/getNFTByWallet';
import { getFearAndGreed } from './tools/getFearAndGreed';
import { tokenSecurityChecker } from './tools/tokenSecurityChecker';
import { tokenSearchAndInfo } from './tools/tokenSearchAndInfo';



export function setupServerTools(server: McpServer) {
  // fetches Token Balances for an specific wallet (REQUIRES MORALIS'S API KEY)
  getWalletTokenBalance(server);
  // gets Transactions History for an specific wallet. (REQUIRES MORALIS'S API KEY)
  getWalletTokenTransactions(server); 
  // fetches NFTs by wallet
  getNFTByWallet(server);
  // simply gets the fear and greed index information. (REQUIRES MORALIS'S API KEY)
  getFearAndGreed(server);
  // tracks large whale transactions (buys/sells) across ETH and BSC chains. (REQUIRES DEXCHECK's API KEY)
  whaleTracker(server);
  // tracks transactions across multiple chains. (REQUIRES MORALIS'S API KEY)
  transactionTracker(server);
  // Analyzes tokens on binance. (REQUIRES TAAPI'S API KEY)
  tokenAnalyzer(server);
  // Checks if a token is safe.
  tokenSecurityChecker(server);
  // Searches a token's name and returns its info (Contract Address, price, etc).
  tokenSearchAndInfo(server);
}
