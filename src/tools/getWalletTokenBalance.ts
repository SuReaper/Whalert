import { z } from "zod";
import { env } from "cloudflare:workers";
import { getFearGreed, formatFearGreed } from '../utils.js';

export function getWalletTokenBalance(server: any) {
  server.tool(
    'getWalletTokenBalance',
    'Gets token balances for a wallet across ETH, Avalanche, and BSC chains. Filters out tokens with total value less than minimum USD value.',
    {
      walletAddress: z.string().describe('The wallet address to check (0x...)'),
      minValue: z.number().optional().describe('Minimum USD value to include (default: 1)')
    },
    async ({ walletAddress, minValue }: { walletAddress: string; minValue?: number }) => {
      const minValueThreshold = minValue ?? 1;
      const apiKey = env.MORALIS_API_KEY;

      // Need the api key or we get an error
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

      // Types from Moralis Docs
      interface MoralisTokenResponse {
        token_address: string;
        symbol: string;
        name: string;
        balance_formatted: string;
        usd_price?: string;
        usd_value?: string;
        usd_price_24hr_percent_change?: string;
        usd_price_24hr_usd_change?: string;
        portfolio_percentage?: string;
      }

      interface MoralisApiResponse {
        result?: MoralisTokenResponse[];
      }

      interface ChainFetchResult {
        chain: string;
        data: MoralisApiResponse | null;
        error: string | null;
      }

      // cleaned up version for our response
      interface FormattedToken {
        chain: string;
        token_address: string;
        symbol: string;
        name: string;
        balance_formatted: string;
        balance_formatted_in_usd: string;
        usd_price: string;
        usd_price_24hr_percent_change: string;
        usd_price_24hr_usd_change: string;
        portfolio_percentage: string;
      }

      // which chains we want to check
      const CHAINS = ['eth', 'avalanche', 'bsc'] as const;
      const MORALIS_API_BASE = 'https://deep-index.moralis.io/api/v2.2';

      // standard headers for all requests
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-API-Key': apiKey
        }
      };

      // query params to filter out garbage
      const queryParams = new URLSearchParams({
        format: 'decimal',
        order: 'DESC',
        limit: '15',
        exclude_unverified_contracts: 'true',
        exclude_spam: 'true'
      });

      // format the token data so it looks nice in our response
      const formatTokenData = (chain: string, token: MoralisTokenResponse): FormattedToken => {
        const balance = parseFloat(token.balance_formatted || '0');
        const price = parseFloat(token.usd_price || '0');
        const usdValue = (balance * price).toFixed(2);

        return {
          chain,
          token_address: token.token_address,
          symbol: token.symbol,
          name: token.name,
          balance_formatted: token.balance_formatted,
          balance_formatted_in_usd: usdValue,
          usd_price: parseFloat(token.usd_price || '0').toFixed(2),
          usd_price_24hr_percent_change: parseFloat(token.usd_price_24hr_percent_change || '0').toFixed(2),
          usd_price_24hr_usd_change: parseFloat(token.usd_price_24hr_usd_change || '0').toFixed(2),
          portfolio_percentage: parseFloat(token.portfolio_percentage || '0').toFixed(2)
        };
      };

      // fetch tokens for one chain
      const fetchChainTokens = (chain: string): Promise<ChainFetchResult> => {
        const url = `${MORALIS_API_BASE}/wallets/${walletAddress}/tokens?chain=${chain}&${queryParams.toString()}`;

        return fetch(url, fetchOptions)
          .then(res => res.json() as Promise<MoralisApiResponse>)
          .then(data => ({ chain, data, error: null }))
          .catch(err => ({
            chain,
            data: null,
            error: err instanceof Error ? err.message : 'Unknown error'
          }));
      };

      // main logic
      try {
        const results = await Promise.all(CHAINS.map(fetchChainTokens));
        const allTokens: FormattedToken[] = [];

        // go through each chain and collect valid tokens
        results.forEach(({ chain, data, error }) => {
          if (error) {
            console.error(`[${chain}] Error:`, error);
            return;
          }

          if (!data?.result?.length) {
            return;
          }

          const tokens = data.result
            .filter(token => parseFloat(token.usd_value || '0') >= minValueThreshold)
            .map(token => formatTokenData(chain, token));

          allTokens.push(...tokens);
        });

        // no tokens found with the minimum value
        if (!allTokens.length) {
          return {
            content: [
              {
                type: "text",
                text: `No tokens found with value ≥ $${minValueThreshold}`
              }
            ],
            tokens: [],
            summary: {
              total_tokens: 0,
              chains_checked: CHAINS,
              min_value_threshold: minValueThreshold
            }
          };
        }

        // format the response text with emojis and formatting
        const responseText = [
          `✅ Wallet Token Balance Report`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `📊 Total Tokens: ${allTokens.length}`,
          `⛓️ Chains: ${CHAINS.join(', ').toUpperCase()}`,
          `🔗 Wallet: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`,
          '',
          '```json',
          JSON.stringify(allTokens, null, 2),
          '```'
        ].join('\n');
        
        const fng = await getFearGreed();
        
        return {
          content: [
            { 
              type: "text", 
              text: "Make sure to provide detailed analystics based on the following results, as well as following these rules: Key Metrics: Quantitative or measurable indicators relevant to the topic. Do not make things up that isn't provided to you and you are unsure of. Interpretation: What the data means, not just what it shows. Assumptions: Clearly state what assumptions are being made in your analysis."
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
            tokens: allTokens,
            summary: {
              total_tokens: allTokens.length,
              chains_with_tokens: Array.from(new Set(allTokens.map(t => t.chain))),
              chains_checked: CHAINS,
              min_value_threshold: minValueThreshold
            }
          }
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            { type: "text", text: `❌ Error fetching tokens: ${errorMsg}` }
          ]
        };
      }
    }
  );
}