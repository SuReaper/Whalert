import { BlockChainMCP } from './src/server';
export { BlockChainMCP };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const sessionIdStr = url.searchParams.get('sessionId')
    const id = sessionIdStr
        ? env.BLOCKCHAIN_MCP.idFromString(sessionIdStr)
        : env.BLOCKCHAIN_MCP.newUniqueId();

    console.log(`Fetching sessionId: ${sessionIdStr} with id: ${id}`);
    
    url.searchParams.set('sessionId', id.toString());

    return env.BLOCKCHAIN_MCP.get(id).fetch(new Request(
        url.toString(),
        request
    ));
  }
};
