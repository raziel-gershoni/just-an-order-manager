import { groupForBearer } from '@/lib/mcp/key';
import { mcpHandlerForGroup } from '@/lib/mcp/server';

// The bakery MCP server: MCP over Streamable HTTP, stateless. The bearer key
// picks the bakery; there is no Telegram login here.
export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  const groupId = await groupForBearer(req.headers.get('authorization'));
  if (groupId === null) {
    console.warn('[mcp] rejected: bad key');
    return Response.json({ error: 'invalid key' }, { status: 401 });
  }
  return mcpHandlerForGroup(groupId)(req);
}

export { handle as GET, handle as POST };
