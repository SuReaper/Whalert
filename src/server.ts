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
      name: 'Whalert',
      version: '1.0.0',
    };
  }

  configureServer(server: McpServer): void {
    // create a function to get the alert monitor instance
    const getAlertMonitor = () => {
      const id = this.env.TOKEN_ALERT_MONITOR.idFromName('global');
      return this.env.TOKEN_ALERT_MONITOR.get(id);
    };

    // pass env and getAlertMonitor to setupServerTools
    setupServerTools(server, this.env, getAlertMonitor);
    setupServerResources(server);
  }
}