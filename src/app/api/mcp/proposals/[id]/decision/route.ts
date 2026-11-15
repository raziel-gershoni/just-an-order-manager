import { z } from 'zod/v4';
import { groupForBearer } from '@/lib/mcp/key';
import { decideProposal, type DecisionResult } from '@/lib/proposals/engine';
import { t } from '@/lib/i18n';

// The owner's approve / reject, called by the chat bot's button handler with
// the Telegram id of whoever pressed. Deliberately an HTTP route and not an MCP
// tool, so Claude can propose but never decide. The owner check is made inside
// decideProposal from the bakery's own member list.
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  telegramUserId: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
  decision: z.enum(['approve', 'reject']),
});

const STATUS: Record<DecisionResult['outcome'], number> = {
  applied: 200,
  rejected: 200,
  not_owner: 403,
  not_found: 404,
  already_decided: 409,
  expired: 409,
  stale: 409,
  failed: 500,
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const groupId = await groupForBearer(req.headers.get('authorization'));
  if (groupId === null) {
    console.warn('[mcp] rejected: bad key (decision)');
    return Response.json({ error: 'invalid key' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    console.warn('[mcp-decision] body is not JSON', e);
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) {
    console.warn('[mcp-decision] bad body', body.error.issues.map((i) => i.path.join('.')).join(','));
    return Response.json({ error: 'expected { telegramUserId, decision: "approve" | "reject" }' }, { status: 400 });
  }

  const { id } = await ctx.params;
  const proposalId = /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(proposalId)) {
    return Response.json({ outcome: 'not_found', message: t('mcp.decision_not_found') }, { status: 404 });
  }

  const result = await decideProposal(groupId, proposalId, String(body.data.telegramUserId), body.data.decision);
  return Response.json({ outcome: result.outcome, message: result.messageHe }, { status: STATUS[result.outcome] });
}
