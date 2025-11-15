import { z } from "zod";
import { env } from "cloudflare:workers";
import { getFearGreed, formatFearGreed } from '../utils.js';



export function whaleTracker(server: any) {
  server.tool(
    'whaleTracker',
    'Tracks large whale transactions (buys/sells) across ETH and BSC chains. Returns the 10 most recent transactions from each chain based on timestamp, showing significant trades above the minimum USD threshold. Useful for monitoring smart money movements and large market activities.',
    {
      minUsd: z.number().optional().describe('Minimum USD value for transactions (default: 10000)'),
      page: z.number().optional().describe('Page number for pagination (default: 1)')
    },
    async ({ minUsd, page }: { minUsd?: number; page?: number }) => {
      const minUsdThreshold = minUsd ?? 10000;
      const pageNumber = page ?? 1;
      const apiKey = env.DEXCHECK_API_KEY;

      // need the api key
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "Error: DEXCHECK_API_KEY environment variable is not set. Set it using: `wrangler secret put DEXCHECK_API_KEY`"
            }
          ]
        };
      }

      // types from dexcheck api response
      interface DexCheckWhaleTransaction {
        side: string;
        usd_price: number;
        pair_id: string;
        tx_hash: string;
        amount_usd: number;
        pair: string;
        epoch_time: number;
        exchange: string;
        maker: string;
        base_id: string;
        base_name: string;
        base_symbol: string;
        quote_name: string;
        quote_symbol: string;
        token_qty: number;
        pair_created: number;
        mcap: number;
      }

      // cleaned up version for our response - only the fields we care about
      interface FormattedWhaleTransaction {
        side: string;
        usd_price: string; // formatted with proper decimals
        pair_id: string; // token address
        tx_hash: string;
        amount_usd: string; // formatted with commas and 2 decimals
        pair: string;
        exchange: string;
        wallet_address: string; // renamed from 'maker'
        base_name: string;
        base_symbol: string;
        mcap: string; // formatted with $ sign
        epoch_time: number; // keep for display
        chain: string; // which chain this transaction came from
      }

      // which chains we support - only bsc and eth as per api limitations
      const CHAINS = ['bsc', 'eth'] as const;
      const DEXCHECK_API_BASE = 'https://api.dexcheck.ai/api/v1/blockchain/whale-tracker';

      // standard headers for all requests - using X-API-Key pattern
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-API-Key': apiKey
        }
      };

      // format USD price properly - show actual price with appropriate decimals
      const formatUsdPrice = (price: number): string => {
        if (price === 0) return '$0.00';
        
        // for prices >= 1, show 2 decimals with commas
        if (price >= 1) {
          return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        
        // for small prices < 1, show more decimals to be meaningful
        if (price < 0.01) {
          return `$${price.toFixed(6)}`; // 6 decimals for very small prices
        }
        
        return `$${price.toFixed(4)}`; // 4 decimals for prices between 0.01 and 1
      };

      // format amount USD with commas and 2 decimals
      const formatAmountUsd = (amount: number): string => {
        return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      };

      // format market cap - show $0 if it's 0, otherwise format properly
      const formatMcap = (mcap: number): string => {
        if (mcap === 0) return '$0';
        return `$${mcap.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      };

      // format the transaction data to only include what we need
      const formatTransaction = (chain: string, tx: DexCheckWhaleTransaction): FormattedWhaleTransaction => {
        return {
          side: tx.side,
          usd_price: formatUsdPrice(tx.usd_price),
          pair_id: tx.pair_id, // this is the token address
          tx_hash: tx.tx_hash,
          amount_usd: formatAmountUsd(tx.amount_usd),
          pair: tx.pair,
          exchange: tx.exchange,
          wallet_address: tx.maker,
          base_name: tx.base_name,
          base_symbol: tx.base_symbol,
          mcap: formatMcap(tx.mcap),
          epoch_time: tx.epoch_time,
          chain: chain.toUpperCase()
        };
      };

      // fetch whale transactions for one chain and return top 10 by epoch_time
      const fetchChainWhales = async (chain: string): Promise<{ chain: string; transactions: FormattedWhaleTransaction[]; error: string | null }> => {
        const url = `${DEXCHECK_API_BASE}?chain=${chain}&min_usd=${minUsdThreshold}&page=${pageNumber}`;

        try {
          const response = await fetch(url, fetchOptions);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = await response.json() as DexCheckWhaleTransaction[];
          
          if (!Array.isArray(data) || data.length === 0) {
            return { chain, transactions: [], error: null };
          }

          // The API returns ~20,000 lines per request, so we have to filter out the ones we don't care about
          // Sort by epoch_time and take only the 10 most recent from this chain
          const sortedAndFormatted = data
            .sort((a, b) => b.epoch_time - a.epoch_time) // most recent first
            .slice(0, 10) // take only top 10 from this chain
            .map(tx => formatTransaction(chain, tx));

          return {
            chain,
            transactions: sortedAndFormatted,
            error: null
          };
        } catch (err) {
          return {
            chain,
            transactions: [],
            error: err instanceof Error ? err.message : 'Unknown error'
          };
        }
      };

      // main logic - fetch from both chains and combine results
      try {
        // fetch from both chains in parallel - each will return top 10
        const results = await Promise.all(CHAINS.map(fetchChainWhales));
        const allTransactions: FormattedWhaleTransaction[] = [];

        // collect the top 10 from each chain
        results.forEach(({ chain, transactions, error }) => {
          if (error) {
            console.error(`[${chain}] Error:`, error);
            return;
          }

          // add this chain's top 10 to our combined array
          allTransactions.push(...transactions);
        });

        // no transactions found
        if (!allTransactions.length) {
          return {
            content: [
              {
                type: "text",
                text: `No whale transactions found meeting the minimum threshold of $${minUsdThreshold.toLocaleString()}`
              }
            ],
            _metadata: {
              transactions: [],
              summary: {
                total_transactions: 0,
                chains_checked: CHAINS,
                min_usd_threshold: minUsdThreshold
              }
            }
          };
        }

        // calculate summary stats internally to avoid extra api calls
        // parse back the formatted strings for calculations
        const totalVolume = allTransactions.reduce((sum, tx) => {
          const amount = parseFloat(tx.amount_usd.replace(/[$,]/g, ''));
          return sum + amount;
        }, 0);
        
        const buyCount = allTransactions.filter(tx => tx.side === 'buy').length;
        const sellCount = allTransactions.filter(tx => tx.side === 'sell').length;
        const chainDistribution = allTransactions.reduce((acc, tx) => {
          acc[tx.chain] = (acc[tx.chain] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        // format the response text with emojis and nice formatting
        const responseText = [
          `WHALE TRACKER REPORT`,
          `Total Transactions: ${allTransactions.length}`,
          `Chain Distribution: ${Object.entries(chainDistribution).map(([chain, count]) => `${chain}: ${count}`).join(' | ')}`,
          `Total Volume: $${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
          `Buy Orders: ${buyCount} | Sell Orders: ${sellCount}`,
          `Minimum Threshold: $${minUsdThreshold.toLocaleString()}`,
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
              total_transactions: allTransactions.length,
              total_volume_usd: totalVolume,
              buy_count: buyCount,
              sell_count: sellCount,
              chain_distribution: chainDistribution,
              chains_checked: CHAINS,
              min_usd_threshold: minUsdThreshold,
              page: pageNumber
            }
          }
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            { type: "text", text: `Error retrieving whale transaction data: ${errorMsg}` }
          ]
        };
      }
    }
  );
}