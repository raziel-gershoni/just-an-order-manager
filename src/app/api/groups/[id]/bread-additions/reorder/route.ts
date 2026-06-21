import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadAdditions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';

function getGroupId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  const idx = parts.indexOf('groups');
  return Number(parts[idx + 1]);
}

const reorderSchema = z.object({
  orderedIds: z.array(z.number().int().positive()),
});

export const PUT = withAuth(async (request, auth) => {
  const groupId = getGroupId(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if ((membership.role === 'baker' || membership.role === 'driver')) {
    return errorResponse('Bakers cannot manage bread additions', 403);
  }

  const body = await request.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  await Promise.all(
    parsed.data.orderedIds.map((id, index) =>
      db
        .update(breadAdditions)
        .set({ sortOrder: index })
        .where(and(eq(breadAdditions.id, id), eq(breadAdditions.groupId, groupId)))
    )
  );

  return jsonResponse({ success: true });
});
