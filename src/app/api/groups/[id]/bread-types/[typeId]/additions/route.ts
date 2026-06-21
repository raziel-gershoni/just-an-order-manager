import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadAdditions, breadTypeAdditions } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { z } from 'zod/v4';

function parsePath(url: string): { groupId: number; typeId: number } {
  const parts = new URL(url).pathname.split('/');
  const gIdx = parts.indexOf('groups');
  const tIdx = parts.indexOf('bread-types');
  return {
    groupId: Number(parts[gIdx + 1]),
    typeId: Number(parts[tIdx + 1]),
  };
}

const setSchema = z.object({
  enabled: z.array(z.number().int().positive()),
});

export const PUT = withAuth(async (request, auth) => {
  const { groupId, typeId } = parsePath(request.url);

  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if ((membership.role === 'baker' || membership.role === 'driver')) {
    return errorResponse('Bakers cannot manage bread types', 403);
  }

  const [breadType] = await db
    .select()
    .from(breadTypes)
    .where(and(eq(breadTypes.id, typeId), eq(breadTypes.groupId, groupId)))
    .limit(1);
  if (!breadType) return errorResponse('Bread type not found', 404);

  const body = await request.json();
  const parsed = setSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  if (parsed.data.enabled.length > 0) {
    const valid = await db
      .select({ id: breadAdditions.id })
      .from(breadAdditions)
      .where(
        and(
          inArray(breadAdditions.id, parsed.data.enabled),
          eq(breadAdditions.groupId, groupId)
        )
      );
    if (valid.length !== parsed.data.enabled.length) {
      return errorResponse('One or more additions do not belong to this group', 400);
    }
  }

  // Clean slate: replace the full set of junction rows for this type
  await db.delete(breadTypeAdditions).where(eq(breadTypeAdditions.breadTypeId, typeId));

  if (parsed.data.enabled.length > 0) {
    await db.insert(breadTypeAdditions).values(
      parsed.data.enabled.map((breadAdditionId, idx) => ({
        breadTypeId: typeId,
        breadAdditionId,
        sortOrder: idx,
      }))
    );
  }

  return jsonResponse({ success: true, count: parsed.data.enabled.length });
});
