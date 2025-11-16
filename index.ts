import { BlockChainMCP } from './src/server';
import { TokenAlertMonitor } from './src/alert-monitor'; 

export { BlockChainMCP, TokenAlertMonitor };  

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // route telegram webhook and health check to alert monitor 
    if (url.pathname === '/telegram-webhook' || url.pathname === '/health') {
      const id = env.TOKEN_ALERT_MONITOR.idFromName('global');
      return env.TOKEN_ALERT_MONITOR.get(id).fetch(request);
    }
    

    const sessionIdStr = url.searchParams.get('sessionId');
    const id = sessionIdStr
      ? env.BLOCKCHAIN_MCP.idFromString(sessionIdStr)
      : env.BLOCKCHAIN_MCP.newUniqueId();

    console.log(`Fetching sessionId: ${sessionIdStr} with id: ${id}`);
    
    url.searchParams.set('sessionId', id.toString());

    return env.BLOCKCHAIN_MCP.get(id).fetch(new Request(
      url.toString(),
      request
    ));
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Checking alerts...');
    // get the global alert monitor instance
    const id = env.TOKEN_ALERT_MONITOR.idFromName('global');
    const stub = env.TOKEN_ALERT_MONITOR.get(id);
    
    // call checkAlerts directly on the stub
    ctx.waitUntil(
      stub.checkAlerts().then(() => {
        console.log('✅ Alert check completed');
      }).catch((error: Error) => {
        console.error('❌ Error checking alerts:', error);
      })
    );
  }
};