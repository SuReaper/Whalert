import { z } from "zod";
import { env } from "cloudflare:workers";

export function transactionTracker(server: any) {
  server.tool(
    'transactionTracker',
    'Tracks and retrieves detailed information about a blockchain transaction using its hash. Shows sender/receiver details, gas costs, value transferred, logs, internal transactions, and more. Works across multiple chains like ETH, BSC, Polygon, etc.',
    {
      txHash: z.string().describe('The transaction hash to look up (starts with 0x).'),
      chain: z.string().optional().describe('The blockchain to search on (default: eth). Options: eth, bsc, polygon, avalanche, fantom, arbitrum, optimism')
    },
    async ({ txHash, chain }: { txHash: string; chain?: string }) => {
      const chainToUse = chain ?? 'eth';
      const apiKey = env.MORALIS_API_KEY;

      // api key check
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "Error: MORALIS_API_KEY is missing. Run this to fix it: `wrangler secret put MORALIS_API_KEY`"
            }
          ]
        };
      }

      // moralis types based on their docs
      interface LogEntry {
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
      }

      interface InternalTransaction {
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
      }

      interface MoralisTransactionResponse {
        hash: string;
        nonce: string;
        transaction_index: string;
        from_address_entity?: string;
        from_address_entity_logo?: string;
        from_address: string;
        from_address_label?: string;
        to_address_entity?: string;
        to_address_entity_logo?: string;
        to_address: string;
        to_address_label?: string;
        value: string;
        gas: string;
        gas_price: string;
        input: string;
        receipt_cumulative_gas_used: string;
        receipt_gas_used: string;
        receipt_contract_address: string;
        receipt_root: string;
        receipt_status: string;
        block_timestamp: string;
        block_number: string;
        block_hash: string;
        logs?: LogEntry[];
        internal_transactions?: InternalTransaction[];
      }

      // our cleaned up version for output
      interface FormattedTransaction {
        basic_info: {
          hash: string;
          chain: string;
          status: string;
          timestamp: string;
          block_number: string;
        };
        addresses: {
          from: {
            address: string;
            entity?: string;
            label?: string;
          };
          to: {
            address: string;
            entity?: string;
            label?: string;
          };
        };
        value_and_gas: {
          value_wei: string;
          value_eth: string;
          gas_limit: string;
          gas_used: string;
          gas_price_gwei: string;
          total_gas_cost_eth: string;
        };
        logs_count: number;
        internal_txs_count: number;
        raw_logs?: LogEntry[];
        raw_internal_transactions?: InternalTransaction[];
      }

      const MORALIS_API_BASE = 'https://deep-index.moralis.io/api/v2.2';

      // headers for the api call
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-API-Key': apiKey
        }
      };

      // helper to convert wei to eth (divide by 10^18)
      const weiToEth = (wei: string): string => {
        const weiNum = BigInt(wei);
        const ethValue = Number(weiNum) / 1e18;
        return ethValue.toFixed(6);
      };

      // helper to convert wei to gwei (divide by 10^9)
      const weiToGwei = (wei: string): string => {
        const weiNum = BigInt(wei);
        const gweiValue = Number(weiNum) / 1e9;
        return gweiValue.toFixed(2);
      };

      // make the transaction data look pretty
      const formatTransaction = (tx: MoralisTransactionResponse, chain: string): FormattedTransaction => {
        const gasUsed = BigInt(tx.receipt_gas_used);
        const gasPrice = BigInt(tx.gas_price);
        const totalGasCost = gasUsed * gasPrice;

        return {
          basic_info: {
            hash: tx.hash,
            chain: chain.toUpperCase(),
            status: tx.receipt_status === '1' ? 'Success ✅' : 'Failed ❌',
            timestamp: tx.block_timestamp,
            block_number: tx.block_number
          },
          addresses: {
            from: {
              address: tx.from_address,
              entity: tx.from_address_entity,
              label: tx.from_address_label
            },
            to: {
              address: tx.to_address,
              entity: tx.to_address_entity,
              label: tx.to_address_label
            }
          },
          value_and_gas: {
            value_wei: tx.value,
            value_eth: weiToEth(tx.value),
            gas_limit: tx.gas,
            gas_used: tx.receipt_gas_used,
            gas_price_gwei: weiToGwei(tx.gas_price),
            total_gas_cost_eth: weiToEth(totalGasCost.toString())
          },
          logs_count: tx.logs?.length ?? 0,
          internal_txs_count: tx.internal_transactions?.length ?? 0,
          raw_logs: tx.logs,
          raw_internal_transactions: tx.internal_transactions
        };
      };

      // main logic - fetching transaction
      try {
        const url = `${MORALIS_API_BASE}/transaction/${txHash}?chain=${chainToUse}`;
        
        const response = await fetch(url, fetchOptions);
        
        if (!response.ok) {
          const errorText = await response.text();
          return {
            content: [
              {
                type: "text",
                text: `❌ API Error (${response.status}): ${errorText}`
              }
            ]
          };
        }

        const txData = await response.json() as MoralisTransactionResponse;
        const formattedTx = formatTransaction(txData, chainToUse);

        // builds the response
        const responseText = [
          `🔍 Transaction Details`,
          ``,
          `📋 Basic Info:`,
          `   Hash: ${formattedTx.basic_info.hash}`,
          `   Chain: ${formattedTx.basic_info.chain}`,
          `   Status: ${formattedTx.basic_info.status}`,
          `   Block: #${formattedTx.basic_info.block_number}`,
          `   Time: ${formattedTx.basic_info.timestamp}`,
          ``,
          `👤 From:`,
          `   Address: ${formattedTx.addresses.from.address}`,
          formattedTx.addresses.from.entity ? `   Entity: ${formattedTx.addresses.from.entity}` : '',
          formattedTx.addresses.from.label ? `   Label: ${formattedTx.addresses.from.label}` : '',
          ``,
          `👤 To:`,
          `   Address: ${formattedTx.addresses.to.address}`,
          formattedTx.addresses.to.entity ? `   Entity: ${formattedTx.addresses.to.entity}` : '',
          formattedTx.addresses.to.label ? `   Label: ${formattedTx.addresses.to.label}` : '',
          ``,
          `💰 Value & Gas:`,
          `   Value: ${formattedTx.value_and_gas.value_eth} ETH`,
          `   Gas Used: ${formattedTx.value_and_gas.gas_used} / ${formattedTx.value_and_gas.gas_limit}`,
          `   Gas Price: ${formattedTx.value_and_gas.gas_price_gwei} Gwei`,
          `   Total Gas Cost: ${formattedTx.value_and_gas.total_gas_cost_eth} ETH`,
          ``,
          `📊 Additional Data:`,
          `   Logs: ${formattedTx.logs_count}`,
          `   Internal Transactions: ${formattedTx.internal_txs_count}`,
          ``,
          '```json',
          JSON.stringify(formattedTx, null, 2),
          '```'
        ].filter(line => line !== '').join('\n'); // filter out empty entity/label lines

        return {
          prompt: [{ type: "text", text: "Provide comprehensive analytics based on these results. Include: Key Metrics (quantitative indicators), Interpretation (what the data means), and Assumptions (clearly state any assumptions made). Only reference data that is actually provided - do not speculate or fabricate information."}],
          content: [{ type: "text", text: responseText }],
          transaction: formattedTx,
          summary: {
            hash: formattedTx.basic_info.hash,
            chain: formattedTx.basic_info.chain,
            status: formattedTx.basic_info.status,
            value_eth: formattedTx.value_and_gas.value_eth,
            gas_cost_eth: formattedTx.value_and_gas.total_gas_cost_eth
          }
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Something went wrong';
        return {
          content: [
            { type: "text", text: `Error retrieving transaction data: ${errorMsg}` }
          ]
        };
      }
    }
  );
}