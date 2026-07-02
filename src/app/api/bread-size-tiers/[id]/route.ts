import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadSizeTiers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

function getId(url: string): number {
  return Number(new URL(url).pathname.split('/').at(-1));
}

export const DELETE = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role !== 'owner' && role !== 'manager') return errorResponse('Forbidden', 403);

  const id = getId(request.url);
  if (!Number.isFinite(id)) return errorResponse('Bad id');
  await db
    .delete(breadSizeTiers)
    .where(and(eq(breadSizeTiers.id, id), eq(breadSizeTiers.groupId, groupId)));
  return jsonResponse({ ok: true });
});
