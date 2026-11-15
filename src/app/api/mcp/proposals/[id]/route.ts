import { groupForBearer } from '@/lib/mcp/key';
import { getProposal } from '@/lib/proposals/engine';

// What a proposal says and where it stands, for the chat bot's approval card.
// Authenticated by the bakery's MCP key; another bakery's id answers 404.
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const groupId = await groupForBearer(req.headers.get('authorization'));
  if (groupId === null) {
    console.warn('[mcp] rejected: bad key (proposal read)');
    return Response.json({ error: 'invalid key' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const proposalId = /^\d+$/.test(id) ? Number(id) : NaN;
  const proposal = Number.isSafeInteger(proposalId) ? await getProposal(groupId, proposalId) : null;
  if (!proposal) return Response.json({ error: 'proposal not found' }, { status: 404 });
  return Response.json({ proposal });
}
