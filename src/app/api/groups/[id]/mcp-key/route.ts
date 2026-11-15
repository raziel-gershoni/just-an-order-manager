import { withGroup, jsonResponse, errorResponse, refuseUnlessManager } from '@/lib/api-utils';
import { issueMcpKey, revokeMcpKey } from '@/lib/mcp/key';

// The AI bot's key for this bakery. Owner only (not managers): the key can create
// change proposals, so whoever holds it can put words in front of the owner.
// refuseUnlessManager supplies the path-id check; the role check is narrower.

function refuse(request: Request, auth: Parameters<typeof refuseUnlessManager>[1], groupId: number) {
  const refused = refuseUnlessManager(request, auth, groupId);
  if (refused) return refused;
  if (auth.memberships.find((m) => m.groupId === groupId)?.role !== 'owner') return errorResponse('Forbidden', 403);
  return null;
}

export const POST = withGroup(async (request, auth, groupId) => {
  const refused = refuse(request, auth, groupId);
  if (refused) return refused;
  try {
    const { key, createdAt } = await issueMcpKey(groupId);
    console.log(`[mcp-key] issued for group ${groupId}`);
    return jsonResponse({ key, createdAt: createdAt.toISOString() });
  } catch (err) {
    console.error(`[mcp-key] issuing a key failed for group ${groupId}:`, err);
    return errorResponse('Could not create the key', 500);
  }
});

export const DELETE = withGroup(async (request, auth, groupId) => {
  const refused = refuse(request, auth, groupId);
  if (refused) return refused;
  try {
    await revokeMcpKey(groupId);
    console.log(`[mcp-key] revoked for group ${groupId}`);
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(`[mcp-key] revoking the key failed for group ${groupId}:`, err);
    return errorResponse('Could not disconnect', 500);
  }
});
