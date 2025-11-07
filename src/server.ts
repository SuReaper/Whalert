import { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { McpHonoServerDO } from '@nullshot/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupServerTools } from './tools';
import { setupServerResources } from './resources';


export class BlockChainMCP extends McpHonoServerDO<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  getImplementation(): Implementation {
    return {
      name: 'NullShot BlockChain MCp',
      version: '1.0.0',
    };
  }

  configureServer(server: McpServer): void {
    setupServerTools(server);
    setupServerResources(server);
  }
}