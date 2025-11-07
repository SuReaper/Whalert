import { z } from "zod";

export function tokenSecurityChecker(server: any) {
  server.tool(
    'tokenSecurityChecker',
    'Performs comprehensive security analysis on a token contract (ERC-20) using GoPlus API. Checks for honeypots, contract vulnerabilities, ownership risks, and trading safety across multiple chains.',
    {
      contractAddress: z.string().describe('The token contract address to analyze (0x...)'),
      chainId: z.number().optional().describe('Chain ID (default: 1 for Ethereum). Available: 1=Ethereum, 56=BSC, 42161=Arbitrum, 137=Polygon, 324=zkSync, 59144=Linea, 8453=Base, 534352=Scroll, 10=Optimism, 43114=Avalanche, 250=Fantom, 25=Cronos, 66=OKC, 128=HECO, 100=Gnosis, 10001=ETHW, tron=Tron, 321=KCC, 201022=FON, 5000=Mantle, 204=opBNB, 42766=ZKFair, 81457=Blast, 169=Manta, 80094=Berachain, 2741=Abstract, 177=Hashkey, 146=Sonic, 1514=Story')
    },
    async ({ contractAddress, chainId }: { contractAddress: string; chainId?: number }) => {
      // default to ethereum if no chain specified
      const chain = chainId ?? 1;

      // map of chain IDs to names for better readability
      const CHAIN_NAMES: Record<string, string> = {
        '1': 'Ethereum',
        '56': 'BSC',
        '42161': 'Arbitrum',
        '137': 'Polygon',
        '324': 'zkSync Era',
        '59144': 'Linea Mainnet',
        '8453': 'Base',
        '534352': 'Scroll',
        '10': 'Optimism',
        '43114': 'Avalanche',
        '250': 'Fantom',
        '25': 'Cronos',
        '66': 'OKC',
        '128': 'HECO',
        '100': 'Gnosis',
        '10001': 'ETHW',
        'tron': 'Tron',
        '321': 'KCC',
        '201022': 'FON',
        '5000': 'Mantle',
        '204': 'opBNB',
        '42766': 'ZKFair',
        '81457': 'Blast',
        '169': 'Manta Pacific',
        '80094': 'Berachain',
        '2741': 'Abstract',
        '177': 'Hashkey Chain',
        '146': 'Sonic',
        '1514': 'Story'
      };

      // response interface from goplus api
      interface GoPlusResponse {
        code: number;
        message: string;
        result: {
          [contractAddress: string]: {
            // critical security flags
            is_honeypot: string;
            is_open_source: string;
            is_proxy: string;
            is_mintable: string;
            can_take_back_ownership: string;
            owner_change_balance: string;
            hidden_owner: string;
            selfdestruct: string;
            external_call: string;
            
            // trading restrictions
            buy_tax: string;
            sell_tax: string;
            transfer_tax: string;
            cannot_buy: string;
            cannot_sell_all: string;
            trading_cooldown: string;
            is_anti_whale: string;
            anti_whale_modifiable: string;
            
            // modifiable settings
            slippage_modifiable: string;
            personal_slippage_modifiable: string;
            transfer_pausable: string;
            
            // whitelist/blacklist
            is_whitelisted: string;
            is_blacklisted: string;
            
            // token info
            token_name: string;
            token_symbol: string;
            total_supply: string;
            holder_count: string;
            
            // ownership and creator info
            owner_address: string;
            owner_percent: string;
            owner_balance: string;
            creator_address: string;
            creator_percent: string;
            creator_balance: string;
            
            // liquidity info
            is_in_dex: string;
            dex?: Array<{
              name: string;
              liquidity: string;
              liquidity_type: string;
              pair: string;
            }>;
            
            // holder info
            holders?: Array<{
              address: string;
              tag: string;
              is_contract: number;
              balance: string;
              percent: string;
              is_locked: number;
            }>;
            
            // lp holder info
            lp_holder_count: string;
            lp_total_supply: string;
            lp_holders?: Array<{
              address: string;
              tag: string;
              is_contract: number;
              balance: string;
              percent: string;
              is_locked: number;
            }>;
            
            // other flags
            honeypot_with_same_creator: string;
          };
        };
      }

      // clean format for our response
      interface SecurityAnalysis {
        token_info: {
          name: string;
          symbol: string;
          total_supply: string;
          holder_count: string;
          contract_address: string;
          chain: string;
        };
        critical_risks: {
          is_honeypot: boolean;
          cannot_buy: boolean;
          cannot_sell_all: boolean;
          can_take_back_ownership: boolean;
          hidden_owner: boolean;
          selfdestruct: boolean;
          honeypot_with_same_creator: boolean;
        };
        contract_security: {
          is_open_source: boolean;
          is_proxy: boolean;
          is_mintable: boolean;
          external_call: boolean;
        };
        trading_security: {
          buy_tax: string;
          sell_tax: string;
          transfer_tax: string;
          trading_cooldown: boolean;
          transfer_pausable: boolean;
          is_anti_whale: boolean;
          anti_whale_modifiable: boolean;
          slippage_modifiable: boolean;
        };
        ownership: {
          owner_address: string;
          owner_percent: string;
          creator_address: string;
          creator_percent: string;
        };
        liquidity: {
          is_in_dex: boolean;
          dex_info: Array<{
            name: string;
            liquidity_usd: string;
            type: string;
          }>;
          lp_holder_count: string;
          lp_locked_percent: string;
        };
        top_holders: Array<{
          address: string;
          tag: string;
          is_contract: boolean;
          percent: string;
          is_locked: boolean;
        }>;
        risk_score: number;
        risk_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL';
      }

      try {
        // build the api url
        const url = `https://api.gopluslabs.io/api/v1/token_security/${chain}?contract_addresses=${contractAddress.toLowerCase()}`;
        
        const options = {
          method: 'GET',
          headers: {
            accept: '*/*'
          }
        };

        // fetch the security data
        const response = await fetch(url, options);
        const data: GoPlusResponse = await response.json();

        // check if we got valid data
        if (data.code !== 1 || !data.result) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to fetch security data: ${data.message || 'Unknown error'}\n\nIf you didn't specify a chain, the default was Ethereum (chain ID: 1). Please verify the contract address and chain ID are correct.`
              }
            ]
          };
        }

        const tokenData = data.result[contractAddress.toLowerCase()];
        
        // token not found or invalid
        if (!tokenData) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Token not found on ${CHAIN_NAMES[chain.toString()] || 'chain ' + chain}.\n\nPlease check:\n- Contract address is correct\n- Token exists on the specified chain\n- Chain ID is correct (default: 1 for Ethereum)`
              }
            ]
          };
        }

        // calculate risk score based on critical factors
        let riskScore = 0;
        
        // critical risks (20 points each)
        if (tokenData.is_honeypot === '1') riskScore += 20;
        if (tokenData.cannot_buy === '1') riskScore += 20;
        if (tokenData.cannot_sell_all === '1') riskScore += 20;
        if (tokenData.can_take_back_ownership === '1') riskScore += 15;
        if (tokenData.hidden_owner === '1') riskScore += 15;
        if (tokenData.selfdestruct === '1') riskScore += 20;
        
        // high risks (10 points each)
        if (tokenData.is_open_source === '0') riskScore += 10;
        if (tokenData.is_proxy === '1') riskScore += 8;
        if (tokenData.is_mintable === '1') riskScore += 10;
        if (tokenData.transfer_pausable === '1') riskScore += 8;
        
        // medium risks (5 points each)
        if (parseFloat(tokenData.buy_tax || '0') > 10) riskScore += 5;
        if (parseFloat(tokenData.sell_tax || '0') > 10) riskScore += 5;
        if (tokenData.slippage_modifiable === '1') riskScore += 5;
        if (tokenData.anti_whale_modifiable === '1') riskScore += 3;
        
        // ownership concentration risk
        const ownerPercent = parseFloat(tokenData.owner_percent || '0') * 100;
        const creatorPercent = parseFloat(tokenData.creator_percent || '0') * 100;
        if (ownerPercent > 50) riskScore += 10;
        else if (ownerPercent > 20) riskScore += 5;
        if (creatorPercent > 50) riskScore += 10;
        else if (creatorPercent > 20) riskScore += 5;
        
        // liquidity risk
        if (tokenData.is_in_dex === '0') riskScore += 15;
        
        // determine risk level
        let riskLevel: SecurityAnalysis['risk_level'];
        if (riskScore >= 50) riskLevel = 'CRITICAL';
        else if (riskScore >= 30) riskLevel = 'HIGH';
        else if (riskScore >= 15) riskLevel = 'MEDIUM';
        else if (riskScore >= 5) riskLevel = 'LOW';
        else riskLevel = 'MINIMAL';

        // calculate lp locked percentage
        let lpLockedPercent = '0';
        if (tokenData.lp_holders && tokenData.lp_holders.length > 0) {
          const totalLocked = tokenData.lp_holders
            .filter(holder => holder.is_locked === 1)
            .reduce((sum, holder) => sum + parseFloat(holder.percent || '0'), 0);
          lpLockedPercent = (totalLocked * 100).toFixed(2);
        }

        // format the analysis
        const analysis: SecurityAnalysis = {
          token_info: {
            name: tokenData.token_name || 'Unknown',
            symbol: tokenData.token_symbol || 'Unknown',
            total_supply: tokenData.total_supply || '0',
            holder_count: tokenData.holder_count || '0',
            contract_address: contractAddress,
            chain: CHAIN_NAMES[chain.toString()] || `Chain ${chain}`
          },
          critical_risks: {
            is_honeypot: tokenData.is_honeypot === '1',
            cannot_buy: tokenData.cannot_buy === '1',
            cannot_sell_all: tokenData.cannot_sell_all === '1',
            can_take_back_ownership: tokenData.can_take_back_ownership === '1',
            hidden_owner: tokenData.hidden_owner === '1',
            selfdestruct: tokenData.selfdestruct === '1',
            honeypot_with_same_creator: tokenData.honeypot_with_same_creator === '1'
          },
          contract_security: {
            is_open_source: tokenData.is_open_source === '1',
            is_proxy: tokenData.is_proxy === '1',
            is_mintable: tokenData.is_mintable === '1',
            external_call: tokenData.external_call === '1'
          },
          trading_security: {
            buy_tax: `${(parseFloat(tokenData.buy_tax || '0') * 100).toFixed(2)}%`,
            sell_tax: `${(parseFloat(tokenData.sell_tax || '0') * 100).toFixed(2)}%`,
            transfer_tax: `${(parseFloat(tokenData.transfer_tax || '0') * 100).toFixed(2)}%`,
            trading_cooldown: tokenData.trading_cooldown === '1',
            transfer_pausable: tokenData.transfer_pausable === '1',
            is_anti_whale: tokenData.is_anti_whale === '1',
            anti_whale_modifiable: tokenData.anti_whale_modifiable === '1',
            slippage_modifiable: tokenData.slippage_modifiable === '1'
          },
          ownership: {
            owner_address: tokenData.owner_address || 'None',
            owner_percent: `${(parseFloat(tokenData.owner_percent || '0') * 100).toFixed(2)}%`,
            creator_address: tokenData.creator_address || 'Unknown',
            creator_percent: `${(parseFloat(tokenData.creator_percent || '0') * 100).toFixed(2)}%`
          },
          liquidity: {
            is_in_dex: tokenData.is_in_dex === '1',
            dex_info: (tokenData.dex || []).map(d => ({
              name: d.name,
              liquidity_usd: `$${parseFloat(d.liquidity || '0').toLocaleString()}`,
              type: d.liquidity_type
            })),
            lp_holder_count: tokenData.lp_holder_count || '0',
            lp_locked_percent: `${lpLockedPercent}%`
          },
          top_holders: (tokenData.holders || []).slice(0, 10).map(h => ({
            address: h.address,
            tag: h.tag || 'Unknown',
            is_contract: h.is_contract === 1,
            percent: `${(parseFloat(h.percent || '0') * 100).toFixed(2)}%`,
            is_locked: h.is_locked === 1
          })),
          risk_score: riskScore,
          risk_level: riskLevel
        };

        // build the response text with emojis and formatting
        const getRiskEmoji = (level: string) => {
          switch(level) {
            case 'CRITICAL': return '🚨';
            case 'HIGH': return '⚠️';
            case 'MEDIUM': return '⚡';
            case 'LOW': return '✅';
            case 'MINIMAL': return '🟢';
            default: return '❓';
          }
        };

        const responseText = [
          `${getRiskEmoji(riskLevel)} Token Security Analysis Report`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          ``,
          `📊 TOKEN INFORMATION`,
          `Name: ${analysis.token_info.name}`,
          `Symbol: ${analysis.token_info.symbol}`,
          `Chain: ${analysis.token_info.chain}`,
          `Contract: ${contractAddress.slice(0, 6)}...${contractAddress.slice(-4)}`,
          `Holders: ${analysis.token_info.holder_count}`,
          ``,
          `🎯 RISK ASSESSMENT`,
          `Risk Level: ${riskLevel}`,
          `Risk Score: ${riskScore}/100`,
          ``,
          `🔒 CRITICAL SECURITY CHECKS`,
          `Honeypot: ${analysis.critical_risks.is_honeypot ? '❌ YES - DANGER!' : '✅ No'}`,
          `Can Buy: ${analysis.critical_risks.cannot_buy ? '❌ NO - DANGER!' : '✅ Yes'}`,
          `Can Sell All: ${analysis.critical_risks.cannot_sell_all ? '❌ NO - DANGER!' : '✅ Yes'}`,
          `Hidden Owner: ${analysis.critical_risks.hidden_owner ? '⚠️ Yes' : '✅ No'}`,
          `Can Take Back Ownership: ${analysis.critical_risks.can_take_back_ownership ? '⚠️ Yes' : '✅ No'}`,
          `Self Destruct: ${analysis.critical_risks.selfdestruct ? '❌ YES - DANGER!' : '✅ No'}`,
          ``,
          `📝 CONTRACT PROPERTIES`,
          `Open Source: ${analysis.contract_security.is_open_source ? '✅ Yes' : '⚠️ No'}`,
          `Proxy Contract: ${analysis.contract_security.is_proxy ? '⚠️ Yes' : '✅ No'}`,
          `Mintable: ${analysis.contract_security.is_mintable ? '⚠️ Yes' : '✅ No'}`,
          `External Calls: ${analysis.contract_security.external_call ? '⚠️ Yes' : '✅ No'}`,
          ``,
          `💰 TRADING SECURITY`,
          `Buy Tax: ${analysis.trading_security.buy_tax}`,
          `Sell Tax: ${analysis.trading_security.sell_tax}`,
          `Transfer Tax: ${analysis.trading_security.transfer_tax}`,
          `Trading Cooldown: ${analysis.trading_security.trading_cooldown ? '⚠️ Yes' : '✅ No'}`,
          `Transfer Pausable: ${analysis.trading_security.transfer_pausable ? '⚠️ Yes' : '✅ No'}`,
          `Slippage Modifiable: ${analysis.trading_security.slippage_modifiable ? '⚠️ Yes' : '✅ No'}`,
          ``,
          `👤 OWNERSHIP`,
          `Owner Holding: ${analysis.ownership.owner_percent}`,
          `Creator Holding: ${analysis.ownership.creator_percent}`,
          ``,
          `💧 LIQUIDITY`,
          `Listed on DEX: ${analysis.liquidity.is_in_dex ? '✅ Yes' : '❌ No'}`,
          `LP Locked: ${analysis.liquidity.lp_locked_percent}`,
          analysis.liquidity.dex_info.length > 0 ? `DEX Liquidity: ${analysis.liquidity.dex_info.map(d => `${d.name} (${d.liquidity_usd})`).join(', ')}` : '',
          '',
          '```json',
          JSON.stringify(analysis, null, 2),
          '```'
        ].filter(line => line !== '').join('\n');

        return {
          content: [
            {
              type: "text",
              text: "Provide a comprehensive security analysis based on these results. Follow these rules strictly: 1) Explain what each risk factor means in practical terms for potential investors. 2) Highlight any CRITICAL risks prominently and explain why they're dangerous. 3) Provide actionable recommendations (e.g., 'Avoid this token', 'Exercise extreme caution', 'Acceptable risk for experienced traders'). 4) If there are high taxes (>10%), explain the impact on trading. 5) Explain ownership concentration risks if owner/creator holds >20%. 6) Assess liquidity adequacy and lock status. 7) Do NOT make up information not provided in the data. 8) Be objective and professional in your analysis."
            },
            {
              type: "text",
              text: responseText
            }
          ],
          _metadata: {
            analysis: analysis,
            chain_info: {
              chain_id: chain,
              chain_name: CHAIN_NAMES[chain.toString()] || `Unknown (${chain})`
            }
          }
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: "text",
              text: `❌ Error performing security analysis: ${errorMsg}\n\nPlease check:\n- Contract address is valid\n- Chain ID is correct (default: 1 for Ethereum)\n- Network connection is stable`
            }
          ]
        };
      }
    }
  );
}