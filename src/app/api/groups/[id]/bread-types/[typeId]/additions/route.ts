import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadAdditions, breadTypeAdditions } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { z } from 'zod/v4';
import { revalidatePublicSite } from '@/lib/public-site';

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

  // Clean slate — but only over the additions this editor could actually see.
  // The detail GET lists active additions only, so a PAUSED one is never in the
  // payload, and a delete scoped to the bread alone dropped its link every time
  // any bread was saved: unpause the addition weeks later and it is quietly no
  // longer offered on that bread. Requested ids are in scope too, so one paused
  // between load and save is replaced rather than colliding with its own key.
  const activeAdditions = await db
    .select({ id: breadAdditions.id })
    .from(breadAdditions)
    .where(and(eq(breadAdditions.groupId, groupId), eq(breadAdditions.isActive, true)));
  const scope = [...new Set([...activeAdditions.map((a) => a.id), ...parsed.data.enabled])];
  if (scope.length > 0) {
    await db
      .delete(breadTypeAdditions)
      .where(
        and(
          eq(breadTypeAdditions.breadTypeId, typeId),
          inArray(breadTypeAdditions.breadAdditionId, scope)
        )
      );
  }

  if (parsed.data.enabled.length > 0) {
    await db.insert(breadTypeAdditions).values(
      parsed.data.enabled.map((breadAdditionId, idx) => ({
        breadTypeId: typeId,
        breadAdditionId,
        sortOrder: idx,
      }))
    );
  }

  // The public modal lists each type's additions — purge its cache.
  revalidatePublicSite(groupId);
  return jsonResponse({ success: true, count: parsed.data.enabled.length });
});
