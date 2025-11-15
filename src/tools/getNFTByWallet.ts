import { z } from "zod";
import { env } from "cloudflare:workers";

export function getNFTByWallet(server: any) {
  server.tool(
    'getNFTByWallet',
    'Gets NFT collection owned by a wallet address. Returns up to 5 NFTs with details like floor price, rarity, and last sale info. User must specify which chain to check. (eth, bsc, etc.)',
    {
      walletAddress: z.string().describe('The wallet address to check (0x...)'),
      chain: z.string().describe('Chain to check - options: eth, sepolia, holesky, polygon, amoy, bsc, bsc testnet, arbitrum, base, base sepolia, optimism, linea, linea sepolia, avalanche, fantom, cronos, gnosis, gnosis testnet, chiliz, chiliz testnet, moonbeam, moonriver, moonbase, flow, flow-testnet, ronin, ronin-testnet, lisk, lisk-sepolia, pulse, sei, sei-testnet')
    },
    async ({ walletAddress, chain }: { walletAddress: string; chain: string }) => {
      const apiKey = env.MORALIS_API_KEY;

      // Should have the api key
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

      // Types from moralis nft api docs
      interface MoralisNFTLastSale {
        transaction_hash: string;
        block_timestamp: string;
        buyer_address: string;
        seller_address: string;
        price: string;
        price_formatted: string;
        usd_price_at_sale: string;
        current_usd_value: string;
        token_address: string;
        token_id: string;
      }

      interface MoralisNFTResponse {
        token_address: string;
        token_id: string;
        contract_type: string;
        owner_of: string;
        name: string;
        symbol: string;
        amount: string;
        token_uri?: string;
        metadata?: string;
        normalized_metadata?: string;
        media?: string;
        rarity_rank?: number;
        rarity_percentage?: number;
        rarity_label?: string;
        possible_spam: string;
        verified_collection: string;
        floor_price?: string;
        floor_price_usd?: string;
        floor_price_currency?: string;
        last_sale?: MoralisNFTLastSale;
        last_token_uri_sync?: string;
        last_metadata_sync?: string;
      }

      interface MoralisNFTApiResponse {
        status?: string;
        page?: string;
        page_size?: string;
        cursor?: string;
        result?: MoralisNFTResponse[];
      }

      // cleaned up version for our response
      interface FormattedNFT {
        chain: string;
        collection_name: string;
        symbol: string;
        token_address: string;
        token_id: string;
        contract_type: string;
        amount: string;
        floor_price_usd: string;
        floor_price_currency: string;
        verified_collection: boolean;
        rarity_info?: {
          rank: number;
          percentage: number;
          label: string;
        };
        last_sale?: {
          price_formatted: string;
          usd_price_at_sale: string;
          buyer: string;
          seller: string;
          timestamp: string;
        };
      }

      const MORALIS_API_BASE = 'https://deep-index.moralis.io/api/v2.2';

      // standard headers for all requests
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-API-Key': apiKey
        }
      };

      // query params to keep it clean
      const queryParams = new URLSearchParams({
        chain: chain,
        format: 'decimal',
        limit: '5',
        exclude_spam: 'true'
      });

      // format the nft data so it looks nice
      const formatNFTData = (chain: string, nft: MoralisNFTResponse): FormattedNFT => {
        const formatted: FormattedNFT = {
          chain,
          collection_name: nft.name || 'Unknown',
          symbol: nft.symbol || 'N/A',
          token_address: nft.token_address,
          token_id: nft.token_id,
          contract_type: nft.contract_type,
          amount: nft.amount,
          floor_price_usd: nft.floor_price_usd ? parseFloat(nft.floor_price_usd).toFixed(2) : 'N/A',
          floor_price_currency: nft.floor_price_currency || 'N/A',
          verified_collection: nft.verified_collection === 'true'
        };

        // add rarity if it exists
        if (nft.rarity_rank && nft.rarity_percentage && nft.rarity_label) {
          formatted.rarity_info = {
            rank: nft.rarity_rank,
            percentage: nft.rarity_percentage,
            label: nft.rarity_label
          };
        }

        // add last sale if it exists
        if (nft.last_sale) {
          formatted.last_sale = {
            price_formatted: nft.last_sale.price_formatted,
            usd_price_at_sale: nft.last_sale.usd_price_at_sale,
            buyer: `${nft.last_sale.buyer_address.slice(0, 6)}...${nft.last_sale.buyer_address.slice(-4)}`,
            seller: `${nft.last_sale.seller_address.slice(0, 6)}...${nft.last_sale.seller_address.slice(-4)}`,
            timestamp: nft.last_sale.block_timestamp
          };
        }

        return formatted;
      };

      // main logic
      try {
        const url = `${MORALIS_API_BASE}/${walletAddress}/nft?${queryParams.toString()}`;
        
        const response = await fetch(url, fetchOptions);
        const data = await response.json() as MoralisNFTApiResponse;

        // no nfts found
        if (!data?.result?.length) {
          return {
            content: [
              {
                type: "text",
                text: `No NFTs found for wallet on ${chain.toUpperCase()}`
              }
            ],
            nfts: [],
            summary: {
              total_nfts: 0,
              chain: chain,
              wallet: walletAddress
            }
          };
        }

        // format all the nfts
        const formattedNFTs = data.result.map(nft => formatNFTData(chain, nft));

        // calculate some stats
        const verifiedCount = formattedNFTs.filter(n => n.verified_collection).length;
        const totalFloorValue = formattedNFTs.reduce((sum, nft) => {
          const value = parseFloat(nft.floor_price_usd);
          return sum + (isNaN(value) ? 0 : value);
        }, 0);

        // format the response text with emojis and formatting
        const responseText = [
          `NFT PORTFOLIO ANALYSIS`,
          `Total NFTs: ${formattedNFTs.length}`,
          `Chain: ${chain.toUpperCase()}`,
          `Verified Collections: ${verifiedCount}/${formattedNFTs.length}`,
          `Total Floor Value: $${totalFloorValue.toFixed(2)}`,
          `Wallet: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`,
          '',
          '```json',
          JSON.stringify(formattedNFTs, null, 2),
          '```'
        ].join('\n');

        return {
          content: [
            {
              type: "text",
              text: "Provide detailed analysis of the NFT portfolio including: collection diversity, floor price trends, verified vs unverified ratio, and any notable holdings. Be specific about what the data shows."
            },
            {
              type: "text",
              text: responseText
            }
          ],
          _metadata: {
            nfts: formattedNFTs,
            summary: {
              total_nfts: formattedNFTs.length,
              chain: chain,
              wallet: walletAddress,
              verified_collections: verifiedCount,
              total_floor_value_usd: totalFloorValue.toFixed(2),
              sync_status: data.status || 'unknown'
            }
          }
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            { type: "text", text: `Error retrieving NFT data: ${errorMsg}` }
          ]
        };
      }
    }
  );
}