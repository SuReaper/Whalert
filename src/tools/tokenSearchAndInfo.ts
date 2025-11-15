import { z } from "zod";

export function tokenSearchAndInfo(server: any) {
  server.tool(
    'tokenSearchAndInfo',
    'Searches for tokens on DexScreener and returns details about the top 3 results including chain, price, market cap, pair address, and dex URL.',
    {
      searchQuery: z.string().describe('Token name or symbol to search for (e.g., "snail", "BTC", "pepe")')
    },
    async ({ searchQuery }: { searchQuery: string }) => {
      // dexscreener doesn't need an api key which is nice
      const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/search';
      
      // basic fetch config
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: {
          'Accept': '*/*'
        }
      };

      // types from dexscreener response
      interface BaseToken {
        address: string;
        name: string;
        symbol: string;
      }

      interface QuoteToken {
        address: string;
        name: string;
        symbol: string;
      }

      interface TokenPair {
        chainId: string;
        dexId: string;
        url: string;
        pairAddress: string;
        baseToken: BaseToken;
        quoteToken: QuoteToken;
        priceNative: string;
        priceUsd: string;
        fdv?: number;
        marketCap?: number;
        pairCreatedAt?: number;
      }

      interface DexScreenerResponse {
        schemaVersion: string;
        pairs?: TokenPair[];
      }

      // clean format for our output
      interface FormattedTokenInfo {
        chain: string;
        pairAddress: string;
        tokenName: string;
        tokenSymbol: string;
        priceUsd: string;
        marketCap: string;
        dexUrl: string;
        dexName: string;
      }

      // format market cap nicely with K/M/B suffixes
      const formatMarketCap = (marketCap?: number): string => {
        if (!marketCap || marketCap === 0) return 'N/A';
        
        if (marketCap >= 1_000_000_000) {
          return `$${(marketCap / 1_000_000_000).toFixed(2)}B`;
        } else if (marketCap >= 1_000_000) {
          return `$${(marketCap / 1_000_000).toFixed(2)}M`;
        } else if (marketCap >= 1_000) {
          return `$${(marketCap / 1_000).toFixed(2)}K`;
        }
        return `$${marketCap.toFixed(2)}`;
      };

      // clean up the pair data into something readable
      const formatPairData = (pair: TokenPair): FormattedTokenInfo => {
        return {
          chain: pair.chainId.toUpperCase(),
          pairAddress: pair.pairAddress,
          tokenName: pair.baseToken.name,
          tokenSymbol: pair.baseToken.symbol,
          priceUsd: `$${parseFloat(pair.priceUsd).toFixed(6)}`,
          marketCap: formatMarketCap(pair.marketCap),
          dexUrl: pair.url,
          dexName: pair.dexId
        };
      };

      try {
        // build the search url
        const searchUrl = `${DEXSCREENER_API}?q=${encodeURIComponent(searchQuery)}`;
        
        const response = await fetch(searchUrl, fetchOptions);
        
        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `DexScreener API error: HTTP ${response.status} ${response.statusText}`
              }
            ]
          };
        }

        const data: DexScreenerResponse = await response.json();

        // no results found
        if (!data.pairs || data.pairs.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No tokens found matching "${searchQuery}"\n\nPlease verify your search query and try again with a different term.`
              }
            ]
          };
        }

        // grab top 3 results (or less if there aren't 3)
        const topPairs = data.pairs.slice(0, 3);
        const formattedTokens = topPairs.map(formatPairData);

        // build a nice looking response with all the details
        const responseText = [
          `TOKEN SEARCH RESULTS FOR "${searchQuery}"`,
          `Found ${data.pairs.length} total pairs | Displaying top ${topPairs.length}`,
          '',
          ...formattedTokens.map((token, index) => {
            return [
              `${index + 1}. ${token.tokenName} (${token.tokenSymbol})`,
              `   Chain: ${token.chain}`,
              `   Current Price: ${token.priceUsd}`,
              `   Market Cap: ${token.marketCap}`,
              `   Pair Address: ${token.pairAddress}`,
              `   DEX Platform: ${token.dexName}`,
              `   View on DexScreener: ${token.dexUrl}`,
              ''
            ].join('\n');
          })
        ].join('\n');

        return {
          content: [
            {
              type: "text",
              text: "Provide detailed analysis of these token results. Explain the differences between the three tokens, their chains, market caps, and any notable characteristics. Help the user understand which token might be most relevant to their search."
            },
            {
              type: "text",
              text: responseText
            }
          ],
          _metadata: {
            tokens: formattedTokens,
            summary: {
              total_results: data.pairs.length,
              showing: topPairs.length,
              search_query: searchQuery
            }
          }
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: "text",
              text: `Error occurred during token search: ${errorMsg}`
            }
          ]
        };
      }
    }
  );
}