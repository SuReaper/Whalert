import { z } from "zod";
import { env } from "cloudflare:workers";
import { getFearGreed, formatFearGreed } from '../utils.js';

// All the trading pairs binance supports - don't want the AI trying to analyze tokens that don't eist
const SUPPORTED_PAIRS = [
  "ETH/BTC", "LTC/BTC", "BNB/BTC", "NEO/BTC", "BTC/USDT", "ETH/USDT", "LTC/USDT",
  "BNB/USDT", "ADA/USDT", "XRP/USDT", "DOT/USDT", "DOGE/USDT", "SOL/USDT", 
  "MATIC/USDT", "SHIB/USDT", "AVAX/USDT", "LINK/USDT", "ATOM/USDT", "UNI/USDT",
  "LTC/BTC", "ADA/BTC", "XRP/BTC", "DOT/BTC", "LINK/BTC", "BCH/BTC", "ALGO/BTC",
  //  We can add more but it will overwhelm the ai if it's dumb. better add more if needed.
  // 
];

// timeframes that taapi actually supports
const VALID_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "12h", "1d", "1w"];

export function tokenAnalyzer(server: any) {
  server.tool(
    'tokenAnalyzer',
    'Analyzes a cryptocurrency token using technical indicators on Binance. Provides trading signal recommendations based on multiple indicators including RSI, MACD, EMA, Bollinger Bands, and more. This is NOT financial advice - just technical analysis.',
    {
      symbol: z.string().describe('Trading pair symbol in format COIN/MARKET (e.g., BTC/USDT, ETH/USDT). Must be a Binance-supported pair.'),
      interval: z.string().describe('Timeframe for analysis. Valid options: 1m, 5m, 15m, 30m, 1h, 2h, 4h, 12h, 1d, 1w')
    },
    async ({ symbol, interval }: { symbol: string; interval: string }) => {
      const apiKey = env.TAAPI_API_KEY;

      // make sure we have an api key before doing anything
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "Error: TAAPI_API_KEY environment variable is not set. Please configure it using: `wrangler secret put TAAPI_API_KEY`"
            }
          ]
        };
      }

      // normalize the symbol to uppercase just in case user types it lowercase
      const normalizedSymbol = symbol.toUpperCase();
      
      // check if the timeframe is legit
      if (!VALID_TIMEFRAMES.includes(interval)) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Invalid timeframe "${interval}". Please use one of: ${VALID_TIMEFRAMES.join(', ')}`
            }
          ]
        };
      }

      // check if this is actually a binance pair we support
      if (!SUPPORTED_PAIRS.includes(normalizedSymbol)) {
        return {
          content: [
            {
              type: "text",
              text: `⚠️ Warning: "${normalizedSymbol}" might not be available on Binance. Common pairs include: BTC/USDT, ETH/USDT, SOL/USDT, etc.\n\nNote: This tool only works with Binance pairs. If you're sure this pair exists, I'll try anyway.`
            }
          ]
        };
      }

      // here's where the magic happens - we request a bunch of indicators at once
      // taapi lets us get up to 20 indicators in a single call which is sick
      const requestBody = {
        secret: apiKey,
        construct: {
          exchange: "binance",
          symbol: normalizedSymbol,
          interval: interval,
          indicators: [
            // momentum indicators - help us see if price is overbought/oversold
            { indicator: "rsi", period: 14 },
            { indicator: "stoch" },
            { indicator: "cci", period: 20 },
            { indicator: "mfi", period: 14 },
            
            // trend indicators - show us the direction and strength
            { indicator: "macd" },
            { indicator: "adx", period: 14 },
            { indicator: "ema", period: 20 },
            { indicator: "ema", period: 50, id: "ema_50" },
            { indicator: "ema", period: 200, id: "ema_200" },
            
            // volatility indicators - measure price movement intensity
            { indicator: "bbands", period: 20 },
            { indicator: "atr", period: 14 },
            
            // volume indicators - confirm price movements
            { indicator: "obv" },
            { indicator: "cmf", period: 20 },
            
            // support/resistance
            { indicator: "pivotpoints" },
            
            // price action
            { indicator: "price" }
          ]
        }
      };

      try {
        // Request to taapi
        const response = await fetch('https://api.taapi.io/bulk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Encoding': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          throw new Error(`TAAPI API error: ${response.status} ${response.statusText}`);
        }

                const data = await response.json() as {
          data?: Array<{
            id?: string;
            errors?: string[];
            result?: Record<string, unknown>;
          }>;
        };

        // fetch the fear & greed index
        const fng = await getFearGreed();

        // format all the indicator results nicely
        const formattedResults: any = {};
        
        if (data.data && Array.isArray(data.data)) {
          data.data.forEach((item) => {
            if (item.errors && item.errors.length > 0) {
              // if an indicator failed, note it but keep going
              formattedResults[item.id || "unknown"] = { error: item.errors[0] };
            } else if (item.result) {
              // round all numeric values to 2 decimals
              const rounded: any = {};
              for (const [key, value] of Object.entries(item.result)) {
                if (typeof value === 'number') {
                  rounded[key] = Math.round(value * 100) / 100;
                } else {
                  rounded[key] = value;
                }
              }
              formattedResults[item.id || "unknown"] = rounded;
            }
          });
        }


        // build a nice summary for the AI to work with
        const summary = {
          symbol: normalizedSymbol,
          timeframe: interval,
          exchange: "binance",
          timestamp: new Date().toISOString(),
          indicators: formattedResults,
          fear_and_greed: fng
        };

        return {
          content: [
            {
              type: "text",
              text: `📊 TECHNICAL ANALYSIS INSTRUCTIONS

You are analyzing ${normalizedSymbol} on the ${interval} timeframe on Binance.

CRITICAL RULES FOR ANALYSIS:
1. Base your entire analysis ONLY on the indicator data provided below
2. DO NOT make up or assume any indicator values that aren't present
3. If an indicator has an error, acknowledge it but don't guess its value
4. Provide a balanced view - mention both bullish and bearish signals
5. Always state this is technical analysis, NOT financial advice
6. Be specific with numbers - reference actual indicator values
7. Explain your reasoning using standard technical analysis principles

WHAT TO ANALYZE:
- Trend Direction: Look at EMAs, MACD, ADX
- Momentum: Check RSI, Stochastic, CCI, MFI for overbought/oversold conditions
- Volatility: Use Bollinger Bands and ATR
- Volume Confirmation: Analyze OBV and CMF
- Market Sentiment: Consider the Fear & Greed Index context

RECOMMENDATION FORMAT:
1. Current Market Condition (bullish/bearish/neutral with confidence level)
2. Key Signals (list the most important indicator readings)
3. Potential Entry/Exit Levels (if applicable, based on support/resistance)
4. Risk Assessment (based on volatility indicators)
5. Overall Trading Bias (but remember: NOT financial advice!)

Now analyze the data below:`
            },
            {
              type: "text",
              text: `\n\n🔍 FEAR & GREED INDEX:\n${formatFearGreed(fng)}`
            },
            {
              type: "text",
              text: `\n\n📈 INDICATOR DATA:\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``
            },
            {
              type: "text",
              text: `\n\n💡 SUPPORTED TIMEFRAMES: ${VALID_TIMEFRAMES.join(', ')}

⚠️ DISCLAIMER: This analysis is based purely on technical indicators and should not be considered financial advice. Always do your own research and consider multiple factors before making any trading decisions.`
            }
          ],
          _metadata: summary
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: "text",
              text: `❌ Error fetching technical indicators: ${errorMsg}\n\nPlease check:\n- Symbol format (should be COIN/USDT, e.g., BTC/USDT)\n- Timeframe is valid (${VALID_TIMEFRAMES.join(', ')})\n- The token is listed on Binance`
            }
          ]
        };
      }
    }
  );
}