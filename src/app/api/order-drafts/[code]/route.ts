import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { getDraft, isDraftFresh } from '@/lib/order-drafts';

function getCode(url: string): string {
  return new URL(url).pathname.split('/').at(-1) ?? '';
}

/**
 * A draft opens in the bakery it was read for, whichever bakery the mini app
 * has active; the form checks the two agree. A driver doesn't create orders.
 */
export const GET = withAuth(async (request, auth) => {
  const row = await getDraft(getCode(request.url));
  const membership = row ? auth.memberships.find((m) => m.groupId === row.groupId) : undefined;
  if (!row || !membership || !isDraftFresh(row)) return errorResponse('Draft not found', 404);
  if (membership.role === 'driver') return errorResponse('Forbidden', 403);
  if (row.status === 'used') return jsonResponse({ status: 'used', groupId: row.groupId, orderId: row.orderId });
  if (row.status !== 'ready') return errorResponse('Draft not found', 404);
  return jsonResponse({ status: 'ready', groupId: row.groupId, transcript: row.transcript ?? '', draft: row.draft });
});
