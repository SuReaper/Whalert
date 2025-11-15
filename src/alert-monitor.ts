// src/alert-monitor.ts
import { DurableObject } from "cloudflare:workers";
import { Hono } from 'hono';
import { Bot, webhookCallback } from 'grammy';


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

// dexscreener pair response (simplified for monitoring)
interface DexPairData {
  priceUsd: string;
  priceChange?: {
    h24?: number;
  };
  volume?: {
    h24?: number;
  };
  marketCap?: number;
}

interface DexScreenerResponse {
  pairs?: Array<DexPairData>;
}

export class TokenAlertMonitor extends DurableObject<Env> {
  private app: Hono;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.app = new Hono();

    // set up telegram bot webhook endpoint
    this.setupTelegramWebhook();
  }

  private setupTelegramWebhook() {
    const bot = new Bot(this.env.TGBOT_TOKEN);

    // handle /start command - helps users get their chat ID
    bot.command('start', async (ctx) => {
      const chatId = ctx.chat.id;
      await ctx.reply(
        `*Welcome to Whalert!*\n\n` +
        `Your Chat ID: \`${chatId}\`\n\n` +
        `This ID is required when setting up price alerts through the MCP server. ` +
        `You'll receive instant notifications here whenever your price targets are reached.\n\n` +
        `*Available Commands:*\n` +
        `/start — Display this welcome message\n` +
        `/myalerts — View all your active alerts\n` +
        `/refresh — Force check all alerts immediately\n`,
        { parse_mode: 'Markdown' }
      );
    });

    // show user's active alerts with live prices
    bot.command('myalerts', async (ctx) => {
      const chatId = ctx.chat.id;
      const alerts = await this.getAlertsForChat(chatId);

      if (alerts.length === 0) {
        await ctx.reply('You currently have no active price alerts configured.');
        return;
      }

      await ctx.reply('Fetching current market prices...');

      // batch alerts by pair to minimize API calls
      const pairMap = new Map<string, PriceAlert[]>();
      for (const alert of alerts) {
        const existing = pairMap.get(alert.pairAddress) || [];
        existing.push(alert);
        pairMap.set(alert.pairAddress, existing);
      }

      const alertsWithPrices: Array<{alert: PriceAlert; currentPrice: number}> = [];

      // fetch current prices for each unique pair
      for (const [pairAddress, pairAlerts] of pairMap.entries()) {
        try {
          const response = await fetch(
            `https://api.dexscreener.com/latest/dex/search?q=${pairAddress}`,
            { method: 'GET', headers: { 'Accept': '*/*' } }
          );

          if (response.ok) {
            const data: DexScreenerResponse = await response.json() as DexScreenerResponse;
            if (data.pairs && data.pairs.length > 0) {
              const currentPrice = parseFloat(data.pairs[0].priceUsd);
              for (const alert of pairAlerts) {
                alertsWithPrices.push({ alert, currentPrice });
              }
            } else {
              // fallback to stored price if fetch fails
              for (const alert of pairAlerts) {
                alertsWithPrices.push({ alert, currentPrice: alert.currentPrice });
              }
            }
          } else {
            // fallback to stored price if fetch fails
            for (const alert of pairAlerts) {
              alertsWithPrices.push({ alert, currentPrice: alert.currentPrice });
            }
          }

          // small delay to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          console.error(`Error fetching price for ${pairAddress}:`, error);
          // fallback to stored price if fetch fails
          for (const alert of pairAlerts) {
            alertsWithPrices.push({ alert, currentPrice: alert.currentPrice });
          }
        }
      }

      const alertList = alertsWithPrices.map((item, index) => {
        const { alert, currentPrice } = item;
        let condition = '';
        if (alert.alertType === 'price_above') {
          condition = `above $${alert.targetValue}`;
        } else if (alert.alertType === 'price_below') {
          condition = `below $${alert.targetValue}`;
        } else {
          condition = `${alert.targetValue > 0 ? '+' : ''}${alert.targetValue}%`;
        }

        const priceFormatted = currentPrice < 0.01
          ? currentPrice.toFixed(8)
          : currentPrice.toFixed(2);

        return `${index + 1}. ${alert.tokenName} (${alert.tokenSymbol})\n` +
               `   Chain: ${alert.chainId.toUpperCase()}\n` +
               `   Current: $${priceFormatted}\n` +
               `   Alert: ${condition}`;
      }).join('\n\n');

      await ctx.reply(
        `*Active Price Alerts* (${alertsWithPrices.length})\n\n${alertList}`,
        { parse_mode: 'Markdown' }
      );
    });

    // manual refresh command - force check all alerts immediately
    bot.command('refresh', async (ctx) => {
      const chatId = ctx.chat.id;
      await ctx.reply('Running comprehensive alert check across all monitored tokens...');
      
      try {
        await this.checkAlerts();
        await ctx.reply('Alert check completed successfully. You will be notified if any price targets are reached.');
      } catch (error) {
        console.error('Error during manual refresh:', error);
        await ctx.reply('An error occurred while checking alerts. Please try again in a few moments.');
      }
    });

    // webhook endpoint for telegram
    this.app.post('/telegram-webhook', webhookCallback(bot, 'hono'));

    // health check endpoint
    this.app.get('/health', (c) => {
      return c.json({ status: 'ok', service: 'token-alert-monitor' });
    });
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  // get all active alerts from storage
  private async getAllAlerts(): Promise<PriceAlert[]> {
    const alertsMap = await this.ctx.storage.get<Map<string, PriceAlert>>('alerts');
    if (!alertsMap) return [];
    return Array.from(alertsMap.values());
  }

  // get alerts for specific chat
  private async getAlertsForChat(chatId: number): Promise<PriceAlert[]> {
    const alerts = await this.getAllAlerts();
    return alerts.filter((alert: PriceAlert) => alert.chatId === chatId);
  }

  // add new alert (called from the tool)
  async addAlert(alert: PriceAlert): Promise<void> {
    let alertsMap = await this.ctx.storage.get<Map<string, PriceAlert>>('alerts');
    if (!alertsMap) {
      alertsMap = new Map<string, PriceAlert>();
    }
    alertsMap.set(alert.id, alert);
    await this.ctx.storage.put('alerts', alertsMap);
    console.log(`Alert ${alert.id} successfully registered for ${alert.tokenSymbol}`);
  }

  // remove alert after it triggers
  private async removeAlert(alertId: string): Promise<void> {
    const alertsMap = await this.ctx.storage.get<Map<string, PriceAlert>>('alerts');
    if (alertsMap) {
      alertsMap.delete(alertId);
      await this.ctx.storage.put('alerts', alertsMap);
      console.log(`Alert ${alertId} has been removed from monitoring`);
    }
  }

  // the main monitoring function - called by cron (PUBLIC)
  public async checkAlerts(): Promise<void> {
    const alerts = await this.getAllAlerts();
    
    if (alerts.length === 0) {
      console.log('No active alerts require checking at this time');
      return;
    }

    console.log(`Initiating price check for ${alerts.length} active alert${alerts.length !== 1 ? 's' : ''}...`);

    // batch alerts by pair address to minimize API calls
    const pairMap = new Map<string, PriceAlert[]>();
    for (const alert of alerts) {
      const existing = pairMap.get(alert.pairAddress) || [];
      existing.push(alert);
      pairMap.set(alert.pairAddress, existing);
    }

    const bot = new Bot(this.env.TGBOT_TOKEN);

    // check each unique pair
    for (const [pairAddress, pairAlerts] of pairMap.entries()) {
      try {
        // fetch current price from dexscreener
        const response = await fetch(
          `https://api.dexscreener.com/latest/dex/search?q=${pairAddress}`,
          {
            method: 'GET',
            headers: { 'Accept': '*/*' }
          }
        );

        if (!response.ok) {
          console.error(`Failed to retrieve data for pair ${pairAddress}: HTTP ${response.status}`);
          continue;
        }

        const data: DexScreenerResponse = await response.json() as DexScreenerResponse;
        
        if (!data.pairs || data.pairs.length === 0) {
          console.warn(`No market data available for pair ${pairAddress}`);
          continue;
        }

        const pairData: DexPairData = data.pairs[0];
        const currentPrice = parseFloat(pairData.priceUsd);

        // check each alert for this pair
        for (const alert of pairAlerts) {
          let shouldTrigger = false;
          let triggerMessage = '';

          // check alert conditions
          if (alert.alertType === 'price_above' && currentPrice > alert.targetValue) {
            shouldTrigger = true;
            const change = (((currentPrice - alert.currentPrice) / alert.currentPrice) * 100).toFixed(2);
            triggerMessage = `*Price Alert Triggered*\n\n` +
              `${alert.tokenName} (${alert.tokenSymbol}) has surpassed your target price.\n\n` +
              `Current Price: $${currentPrice < 0.01 ? currentPrice.toFixed(8) : currentPrice.toFixed(2)}\n` +
              `Target Price: $${alert.targetValue}\n` +
              `Price Change: +${change}%`;
          } 
          else if (alert.alertType === 'price_below' && currentPrice < alert.targetValue) {
            shouldTrigger = true;
            const change = (((currentPrice - alert.currentPrice) / alert.currentPrice) * 100).toFixed(2);
            triggerMessage = `*Price Alert Triggered*\n\n` +
              `${alert.tokenName} (${alert.tokenSymbol}) has fallen below your target price.\n\n` +
              `Current Price: $${currentPrice < 0.01 ? currentPrice.toFixed(8) : currentPrice.toFixed(2)}\n` +
              `Target Price: $${alert.targetValue}\n` +
              `Price Change: ${change}%`;
          }
          else if (alert.alertType === 'percent_change') {
            const percentChange = ((currentPrice - alert.currentPrice) / alert.currentPrice) * 100;
            
            // check if we've hit the target percent change
            if (alert.targetValue > 0 && percentChange >= alert.targetValue) {
              shouldTrigger = true;
              const startPrice = alert.currentPrice < 0.01 ? alert.currentPrice.toFixed(8) : alert.currentPrice.toFixed(2);
              triggerMessage = `*Price Alert Triggered*\n\n` +
                `${alert.tokenName} (${alert.tokenSymbol}) has gained ${percentChange.toFixed(2)}%\n\n` +
                `Current Price: $${currentPrice < 0.01 ? currentPrice.toFixed(8) : currentPrice.toFixed(2)}\n` +
                `Starting Price: $${startPrice}\n` +
                `Target Gain: +${alert.targetValue}%`;
            } else if (alert.targetValue < 0 && percentChange <= alert.targetValue) {
              shouldTrigger = true;
              const startPrice = alert.currentPrice < 0.01 ? alert.currentPrice.toFixed(8) : alert.currentPrice.toFixed(2);
              triggerMessage = `*Price Alert Triggered*\n\n` +
                `${alert.tokenName} (${alert.tokenSymbol}) has dropped ${Math.abs(percentChange).toFixed(2)}%\n\n` +
                `Current Price: $${currentPrice < 0.01 ? currentPrice.toFixed(8) : currentPrice.toFixed(2)}\n` +
                `Starting Price: $${startPrice}\n` +
                `Target Drop: ${alert.targetValue}%`;
            }
          }

          // send notification if triggered
          if (shouldTrigger) {
            try {
              // add market cap and 24h change if available
              let additionalInfo = '';
              if (pairData.marketCap) {
                const mcFormatted = pairData.marketCap >= 1_000_000 
                  ? `$${(pairData.marketCap / 1_000_000).toFixed(2)}M`
                  : `$${(pairData.marketCap / 1_000).toFixed(2)}K`;
                additionalInfo += `\nMarket Cap: ${mcFormatted}`;
              }
              if (pairData.priceChange?.h24) {
                additionalInfo += `\n24h Change: ${pairData.priceChange.h24 > 0 ? '+' : ''}${pairData.priceChange.h24.toFixed(2)}%`;
              }

              await bot.api.sendMessage(
                alert.chatId,
                triggerMessage + additionalInfo + `\n\nChain: ${alert.chainId.toUpperCase()}`,
                { parse_mode: 'Markdown' }
              );

              // remove the alert after it triggers
              await this.removeAlert(alert.id);
              console.log(`Alert ${alert.id} successfully triggered and removed from monitoring`);
            } catch (error) {
              console.error(`Failed to deliver notification for alert ${alert.id}:`, error);
            }
          }
        }

        // small delay to respect rate limits (200ms between requests)
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`Error occurred while checking pair ${pairAddress}:`, error);
      }
    }

    console.log(`Alert monitoring cycle completed successfully`);
  }

  // scheduled handler - runs every 5 minutes via cron
  async alarm(): Promise<void> {
    console.log('Executing scheduled alert monitoring cycle...');
    await this.checkAlerts();
  }
}