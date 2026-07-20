import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadSizes } from '@/db/schema';
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
    return errorResponse('Bakers cannot manage bread sizes', 403);
  }

  const body = await request.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  await Promise.all(
    parsed.data.orderedIds.map((id, index) =>
      db
        .update(breadSizes)
        .set({ sortOrder: index })
        .where(and(eq(breadSizes.id, id), eq(breadSizes.groupId, groupId)))
    )
  );

  // No revalidatePublicSite: the public pricelist sorts sizes by effective price,
  // not this sortOrder, so reordering sizes doesn't change public output.
  return jsonResponse({ success: true });
});
