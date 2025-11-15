import { z } from "zod";
import { Bot } from "grammy";
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// our alert storage interface
interface PriceAlert {
  id: string;
  chatId: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  chainId: string;
  pairAddress: string;
  alertType: 'price_above' | 'price_below' | 'percent_change';
  targetValue: number;
  currentPrice: number;
  createdAt: number;
  lastChecked?: number;
}

// dexscreener response types
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
  priceChange?: {
    h1?: number;
    h6?: number;
    h24?: number;
  };
  volume?: {
    h24?: number;
    h6?: number;
    h1?: number;
    m5?: number;
  };
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs?: TokenPair[];
}

interface TokenOption {
  index: number;
  name: string;
  symbol: string;
  chain: string;
  price: string;
  priceRaw: number;
  marketCap: string;
  change24h: string;
  pairAddress: string;
  tokenAddress: string;
  dexUrl: string;
}

// this function registers the price alert tools with your MCP server
export function tokenPriceAlert(server: McpServer, env: Env, getAlertMonitor: () => any) {
  
  // TOOL 1: Search for token and propose alert setup
  server.tool(
    'tokenPriceAlert',
    'Sets up a price alert for a cryptocurrency token. The system will monitor the token and send a Telegram notification when your condition is met. Supports alerts for: reaching a specific price, dropping below a price, or percentage changes. DexScreener rate limit is 300 requests/minute.',
    {
      searchQuery: z.string().describe('Token name, symbol, or contract address to monitor (e.g., "PEPE", "0xabc...")'),
      alertType: z.enum(['price_above', 'price_below', 'percent_change']).describe('Type of alert: "price_above" (notify when price goes above target), "price_below" (notify when price drops below target), or "percent_change" (notify on X% change)'),
      targetValue: z.number().describe('Target value for the alert. For price alerts, this is USD price (e.g., 0.000001). For percent_change, this is the percentage (e.g., -5 for 5% drop, 10 for 10% gain)'),
      telegramChatId: z.number().describe('Your Telegram chat ID where alerts will be sent. Get this from @userinfobot on Telegram or by sending /start to your bot')
    },
    async ({ searchQuery, alertType, targetValue, telegramChatId }: { 
      searchQuery: string;
      alertType: 'price_above' | 'price_below' | 'percent_change';
      targetValue: number;
      telegramChatId: number;
    }) => {
      const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/search';

      try {
        // step 1: search for the token on dexscreener
        const searchUrl = `${DEXSCREENER_API}?q=${encodeURIComponent(searchQuery)}`;
        const response = await fetch(searchUrl, {
          method: 'GET',
          headers: { 'Accept': '*/*' }
        });

        if (!response.ok) {
          return {
            content: [{
              type: "text" as const,
              text: `Failed to retrieve token data from DexScreener: HTTP ${response.status} ${response.statusText}`
            }]
          };
        }

        const data: DexScreenerResponse = await response.json() as DexScreenerResponse;

        if (!data.pairs || data.pairs.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No tokens found matching "${searchQuery}"\n\nPlease verify your search and try:\n• Complete token name (example: "Pepe")\n• Token symbol (example: "PEPE")\n• Contract address (example: "0x...")`
            }]
          };
        }

        // grab top 5 results for user to choose from
        const topPairs = data.pairs.slice(0, 5);
        
        // format the options nicely with proper types
        const tokenOptions: TokenOption[] = topPairs.map((pair: TokenPair, index: number) => {
          const price = parseFloat(pair.priceUsd);
          const priceFormatted = price < 0.01 
            ? `$${price.toFixed(8)}` 
            : `$${price.toFixed(2)}`;
          
          const marketCapFormatted = pair.marketCap 
            ? pair.marketCap >= 1_000_000 
              ? `$${(pair.marketCap / 1_000_000).toFixed(2)}M`
              : `$${(pair.marketCap / 1_000).toFixed(2)}K`
            : 'N/A';

          const change24h = pair.priceChange?.h24 
            ? `${pair.priceChange.h24 > 0 ? '+' : ''}${pair.priceChange.h24.toFixed(2)}%`
            : 'N/A';

          return {
            index: index + 1,
            name: pair.baseToken.name,
            symbol: pair.baseToken.symbol,
            chain: pair.chainId.toUpperCase(),
            price: priceFormatted,
            priceRaw: price,
            marketCap: marketCapFormatted,
            change24h: change24h,
            pairAddress: pair.pairAddress,
            tokenAddress: pair.baseToken.address,
            dexUrl: pair.url
          };
        });

        // build the alert description based on type
        let alertDescription = '';
        if (alertType === 'price_above') {
          alertDescription = `when price goes ABOVE $${targetValue}`;
        } else if (alertType === 'price_below') {
          alertDescription = `when price drops BELOW $${targetValue}`;
        } else {
          alertDescription = `on ${targetValue > 0 ? '+' : ''}${targetValue}% price change`;
        }

        // format response for LLM to confirm with user
        const responseText = [
          `Token Search Results for "${searchQuery}"`,
          `Found ${data.pairs.length} total pairs\n`,
          `TOP ${topPairs.length} MATCHING TOKENS`,
          ...tokenOptions.map((token: TokenOption) => [
            ``,
            `${token.index}. ${token.name} (${token.symbol}) — ${token.chain}`,
            `   Current Price: ${token.price}`,
            `   Market Cap: ${token.marketCap}`,
            `   24h Change: ${token.change24h}`,
            `   Pair Address: ${token.pairAddress.slice(0, 10)}...${token.pairAddress.slice(-8)}`,
            `   View on DEX: ${token.dexUrl}`
          ].join('\n')),
          ``,
          `ALERT CONFIGURATION`,
          `   Type: ${alertType.replace('_', ' ').toUpperCase()}`,
          `   Trigger Condition: ${alertDescription}`,
          `   Telegram Chat ID: ${telegramChatId}`,
          ``,
          `Note: Price monitoring occurs every 5 minutes (DexScreener rate limit: 300 requests/minute)`
        ].join('\n');

        return {
          content: [
            {
              type: "text" as const,
              text: `ACTION REQUIRED: You must ask the user to confirm which token they want to monitor before proceeding. Present the options clearly and request they specify a number (1-${topPairs.length}). Do not proceed with alert setup until explicit confirmation is received to prevent monitoring incorrect tokens.`
            },
            {
              type: "text" as const,
              text: responseText
            }
          ],
          _metadata: {
            action: 'awaiting_user_confirmation',
            tokens: tokenOptions,
            alertConfig: {
              type: alertType,
              target: targetValue,
              chatId: telegramChatId
            }
          }
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{
            type: "text" as const,
            text: `Error occurred during alert setup: ${errorMsg}`
          }]
        };
      }
    }
  );

  // TOOL 2: Confirm and activate the alert after user chooses
  server.tool(
    'confirmTokenAlert',
    'Confirms and activates a price alert after user has selected which token to monitor. This actually creates the alert in the system.',
    {
      tokenChoice: z.number().describe('The number (1-5) of the token the user chose from the previous list'),
      pairAddress: z.string().describe('The pair address of the chosen token'),
      tokenAddress: z.string().describe('The contract address of the chosen token'),
      tokenSymbol: z.string().describe('Token symbol'),
      tokenName: z.string().describe('Token name'),
      chainId: z.string().describe('Blockchain network (e.g., "ethereum", "bsc")'),
      currentPrice: z.number().describe('Current USD price of the token'),
      alertType: z.enum(['price_above', 'price_below', 'percent_change']).describe('Type of alert'),
      targetValue: z.number().describe('Target value for the alert'),
      telegramChatId: z.number().describe('Telegram chat ID for notifications')
    },
    async (params: {
      tokenChoice: number;
      pairAddress: string;
      tokenAddress: string;
      tokenSymbol: string;
      tokenName: string;
      chainId: string;
      currentPrice: number;
      alertType: 'price_above' | 'price_below' | 'percent_change';
      targetValue: number;
      telegramChatId: number;
    }) => {
      try {
        // create the alert object
        const alert: PriceAlert = {
          id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          chatId: params.telegramChatId,
          tokenAddress: params.tokenAddress,
          tokenSymbol: params.tokenSymbol,
          tokenName: params.tokenName,
          chainId: params.chainId,
          pairAddress: params.pairAddress,
          alertType: params.alertType,
          targetValue: params.targetValue,
          currentPrice: params.currentPrice,
          createdAt: Date.now()
        };

        // get the alert monitor and store the alert
        const alertMonitor = getAlertMonitor();
        await alertMonitor.addAlert(alert);

        // build condition text for display
        let conditionText = '';
        if (params.alertType === 'price_above') {
          conditionText = `goes ABOVE $${params.targetValue}`;
        } else if (params.alertType === 'price_below') {
          conditionText = `drops BELOW $${params.targetValue}`;
        } else {
          const direction = params.targetValue > 0 ? 'rises' : 'drops';
          conditionText = `${direction} ${Math.abs(params.targetValue)}%`;
        }

        const priceFormatted = params.currentPrice < 0.01 
          ? params.currentPrice.toFixed(8) 
          : params.currentPrice.toFixed(2);

        const responseText = [
          `PRICE ALERT ACTIVATED`,
          `MONITORING DETAILS`,
          `Token: ${params.tokenName} (${params.tokenSymbol})`,
          `Chain: ${params.chainId.toUpperCase()}`,
          `Current Price: $${priceFormatted}`,
          `Alert Condition: When price ${conditionText}`,
          `Notification Destination: Telegram Chat ${params.telegramChatId}`,
          `Alert ID: ${alert.id}\n`,
          `MONITORING SCHEDULE`,
          `Check Interval: Every 5 minutes`,
          `You will receive a Telegram notification when your price condition is met.\n`,
          `Important: This alert will trigger once and then be automatically removed. You may create additional alerts at any time.`
        ].join('\n');

        // send initial confirmation via telegram
        try {
          const bot = new Bot(env.TGBOT_TOKEN);
          await bot.api.sendMessage(
            params.telegramChatId,
            `*Price Alert Configured*\n\n` +
            `${params.tokenName} (${params.tokenSymbol})\n\n` +
            `You will be notified when price ${conditionText}\n\n` +
            `Current Price: $${priceFormatted}`,
            { parse_mode: 'Markdown' }
          );
        } catch (botError) {
          console.error('Failed to send Telegram confirmation:', botError);
        }

        return {
          content: [{
            type: "text" as const,
            text: responseText
          }],
          _metadata: {
            alertId: alert.id,
            status: 'active',
            alert: alert
          }
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{
            type: "text" as const,
            text: `Error occurred while confirming alert: ${errorMsg}`
          }]
        };
      }
    }
  );
  // TOOL 3: Cancel an existing price alert
  server.tool(
    'cancelAlert',
    'Cancels an active price alert by its ID. Removes the alert from monitoring and sends a confirmation.',
    {
      alertId: z.string().describe('The ID of the alert to cancel'),
      telegramChatId: z.number().optional().describe('Optional Telegram chat ID for confirmation')
    },
    async ({ alertId, telegramChatId }) => {
      try {
        const alertMonitor = getAlertMonitor();
        const alert = await alertMonitor.removeAlert(alertId);

        if (!alert) {
          return {
            content: [{
              type: "text" as const,
              text: `Alert ${alertId} could not be located. It may have already been triggered or previously canceled.`
            }]
          };
        }

        // Send Telegram confirmation if chat ID provided
        if (telegramChatId) {
          try {
            const bot = new Bot(env.TGBOT_TOKEN);
            await bot.api.sendMessage(
              telegramChatId,
              `*Alert Canceled*\n\n` +
              `${alert.tokenName} (${alert.tokenSymbol})\nAlert ID: ${alertId}`,
              { parse_mode: 'Markdown' }
            );
          } catch (botError) {
            console.error('Failed to send Telegram cancellation:', botError);
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: `Alert ${alertId} for ${alert.tokenSymbol} has been successfully canceled. Price monitoring has been stopped for this token.`
          }]
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{
            type: "text" as const,
            text: `Error occurred while canceling alert: ${errorMsg}`
          }]
        };
      }
    }
  );
}