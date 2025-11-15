import { z } from "zod";
import { env } from "cloudflare:workers";
import { getFearGreed, formatFearGreed } from '../utils.js';


export function getWalletTokenTransactions(server: any) {
  server.tool(
    'getWalletTokenTransactions',
    'Gets transaction history (last 5 transactions) for a wallet across ETH, Avalanche, and BSC chains.',
    {
      walletAddress: z.string().describe('The wallet address to check (0x...)'),
      chain: z.string().optional().describe('Chain to check (eth, avalanche, bsc). If not provided, checks all chains.')
    },
    async ({ walletAddress, chain }: { walletAddress: string; chain?: string }) => {
      const apiKey = env.MORALIS_API_KEY;

      // same api key check as the balance tool
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "Error: MORALIS_API_KEY environment variable is not set. Set it using: `wrangler secret put MORALIS_API_KEY`"
            }
          ]
        };
      }

      // pain
      interface MoralisTransactionResponse {
        page: string;
        page_size: string;
        cursor: string;
        result: Array<{
          hash: string;
          nonce: string;
          transaction_index: string;
          from_address_entity: string;
          from_address_entity_logo: string;
          from_address: string;
          from_address_label: string;
          to_address_entity: string;
          to_address_entity_logo: string;
          to_address: string;
          to_address_label: string;
          value: string;
          gas: string;
          gas_price: string;
          input: string;
          receipt_cumulative_gas_used: string;
          receipt_gas_used: string;
          receipt_contract_address: string;
          receipt_status: string;
          transaction_fee: string;
          block_timestamp: string;
          block_number: string;
          block_hash: string;
          internal_transactions: Array<{
            transaction_hash: string;
            block_number: number;
            block_hash: string;
            type: string;
            from: string;
            to: string;
            value: string;
            gas: string;
            gas_used: string;
            input: string;
            output: string;
          }>;
          category: string;
          contract_interactions: string[];
          possible_spam: string;
          method_label: string;
          summary: string;
          nft_transfers: Array<{
            token_address: string;
            token_id: string;
            from_address_entity: string;
            from_address_entity_logo: string;
            from_address: string;
            from_address_label: string;
            to_address_entity: string;
            to_address_entity_logo: string;
            to_address: string;
            to_address_label: string;
            value: string;
            amount: string;
            contract_type: string;
            transaction_type: string;
            log_index: string;
            operator: string;
            possible_spam: string;
            verified_collection: string;
            direction: string;
            collection_logo: string;
            collection_banner_image: string;
            normalized_metadata: string;
          }>;
          erc20_transfers: Array<{
            token_name: string;
            token_symbol: string;
            token_logo: string;
            token_decimals: string;
            address: string;
            block_timestamp: string;
            to_address_entity: string;
            to_address_entity_logo: string;
            to_address: string;
            to_address_label: string;
            from_address_entity: string;
            from_address_entity_logo: string;
            from_address: string;
            from_address_label: string;
            value: number;
            value_formatted: string;
            log_index: number;
            possible_spam: string;
            verified_contract: string;
          }>;
          native_transfers: Array<{
            from_address_entity: string;
            from_address_entity_logo: string;
            from_address: string;
            from_address_label: string;
            to_address_entity: string;
            to_address_entity_logo: string;
            to_address: string;
            to_address_label: string;
            value: string;
            value_formatted: string;
            direction: string;
            internal_transaction: string;
            token_symbol: string;
            token_logo: string;
          }>;
          logs: Array<{
            log_index: string;
            transaction_hash: string;
            transaction_index: string;
            address: string;
            data: string;
            topic0: string;
            topic1: string;
            topic2: string;
            topic3: string;
            block_timestamp: string;
            block_number: string;
            block_hash: string;
          }>;
        }>;
      }

      interface ChainFetchResult {
        chain: string;
        data: MoralisTransactionResponse | null;
        error: string | null;
      }

      // same setup as the balance tool
      const CHAINS = ['eth', 'avalanche', 'bsc'] as const;
      const MORALIS_API_BASE = 'https://deep-index.moralis.io/api/v2.2';

      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-API-Key': apiKey
        }
      };

      // just need last 5 transactions per chain
      const queryParams = new URLSearchParams({
        order: 'DESC',
        limit: '5'
      });

      // fetch transactions for one chain
      const fetchChainTransactions = (chain: string): Promise<ChainFetchResult> => {
        const url = `${MORALIS_API_BASE}/wallets/${walletAddress}/history?chain=${chain}&${queryParams.toString()}`;

        return fetch(url, fetchOptions)
          .then(res => res.json() as Promise<MoralisTransactionResponse>)
          .then(data => ({ chain, data, error: null }))
          .catch(err => ({
            chain,
            data: null,
            error: err instanceof Error ? err.message : 'Unknown error'
          }));
      };

      // main logic - check specified chain or all chains
      try {
        const chainsToCheck = chain ? [chain] : CHAINS;
        const results = await Promise.all(chainsToCheck.map(fetchChainTransactions));
        
        let allTransactions: Record<string, MoralisTransactionResponse> = {};
        let totalTransactions = 0;

        // process each chain's results
        results.forEach(({ chain, data, error }) => {
          if (error) {
            console.error(`[${chain}] Error:`, error);
            return;
          }

          if (!data?.result?.length) {
            return;
          }

          allTransactions[chain] = data;
          totalTransactions += data.result.length;
        });

        // no transactions found
        if (totalTransactions === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No transactions found for wallet ${walletAddress}${chain ? ` on ${chain.toUpperCase()} chain` : ''}`
              }
            ],
            _metadata: {
              transactions: {},
              summary: {
                total_transactions: 0,
                chains_checked: chainsToCheck,
                chains_with_transactions: []
              }
            }
          };
        }

        // format response with summary info
        const chainList = Object.keys(allTransactions).join(', ').toUpperCase();
        const responseText = [
          `WALLET TRANSACTION HISTORY`,
          `Total Transactions: ${totalTransactions}`,
          `Chains Analyzed: ${chainList}`,
          `Wallet Address: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`,
          `Note: Displaying the 5 most recent transactions per chain`,
          '',
          '```json',
          JSON.stringify(allTransactions, null, 2),
          '```'
        ].join('\n');
        
        const fng = await getFearGreed();
        
        return {
          content: [
            {
              type: "text",
              text: "Provide comprehensive analytics based on these results. Include: Key Metrics (quantitative indicators), Interpretation (what the data means), and Assumptions (clearly state any assumptions made). Only reference data that is actually provided - do not speculate or fabricate information."
            },
            { 
              type: "text", 
              text: `Here is the Fear & Greed Index:\n\n${formatFearGreed(fng)}` 
            },
            { 
              type: "text", 
              text: responseText 
            }
          ],
          _metadata: {
            transactions: allTransactions,
            summary: {
              total_transactions: totalTransactions,
              chains_with_transactions: Object.keys(allTransactions),
              chains_checked: chainsToCheck,
              limit_per_chain: 5
            }
          }
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            { type: "text", text: `Error retrieving transaction history: ${errorMsg}` }
          ]
        };
      }
    }
  );
}