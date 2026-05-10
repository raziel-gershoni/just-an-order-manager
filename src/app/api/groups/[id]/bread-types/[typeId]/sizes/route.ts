import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadSizes, breadTypeSizes } from '@/db/schema';
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
  enabled: z.array(
    z.object({
      breadSizeId: z.number().int().positive(),
      priceOverride: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
    })
  ),
});

export const PUT = withAuth(async (request, auth) => {
  const { groupId, typeId } = parsePath(request.url);

  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if (membership.role === 'baker') {
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

  // Verify all referenced sizes belong to this group
  const requestedIds = parsed.data.enabled.map((e) => e.breadSizeId);
  if (requestedIds.length > 0) {
    const valid = await db
      .select({ id: breadSizes.id })
      .from(breadSizes)
      .where(and(inArray(breadSizes.id, requestedIds), eq(breadSizes.groupId, groupId)));
    if (valid.length !== requestedIds.length) {
      return errorResponse('One or more sizes do not belong to this group', 400);
    }
  }

  // Clean slate: delete all junction rows for this type, then re-insert
  await db.delete(breadTypeSizes).where(eq(breadTypeSizes.breadTypeId, typeId));

  if (parsed.data.enabled.length > 0) {
    await db.insert(breadTypeSizes).values(
      parsed.data.enabled.map((e, idx) => ({
        breadTypeId: typeId,
        breadSizeId: e.breadSizeId,
        priceOverride: e.priceOverride ?? null,
        sortOrder: idx,
      }))
    );
  }

  return jsonResponse({ success: true, count: parsed.data.enabled.length });
});
