import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { deleteTier } from '@/lib/catalog-writes';

function getId(url: string): number {
  return Number(new URL(url).pathname.split('/').at(-1));
}

export const DELETE = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role !== 'owner' && role !== 'manager') return errorResponse('Forbidden', 403);

  const id = getId(request.url);
  if (!Number.isFinite(id)) return errorResponse('Bad id');
  const result = await deleteTier(groupId, { id });
  if (!result.ok) return errorResponse(result.error, result.status);
  return jsonResponse({ ok: true });
});
