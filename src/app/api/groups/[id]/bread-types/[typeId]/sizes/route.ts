import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadSizes, breadTypeSizes } from '@/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
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
  enabled: z.array(
    z.object({
      breadSizeId: z.number().int().positive(),
      priceOverride: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
      badgeType: z.string().max(20).nullable().optional(),
      badgeLabel: z.string().max(40).nullable().optional(),
      badgeIcon: z.string().max(20).nullable().optional(),
    })
  ),
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

  // Clean slate — but only over the sizes this editor could actually see. The
  // detail GET lists active sizes only, so a PAUSED size is never in the
  // payload, and a delete scoped to the bread alone threw its link away every
  // time any bread was saved: the per-bread price and badges on a paused size
  // vanished, and pausing is exactly what this app tells owners to do instead
  // of deleting. Requested ids are in scope too, so a size paused between load
  // and save is still replaced rather than colliding with its own primary key.
  const activeSizes = await db
    .select({ id: breadSizes.id })
    .from(breadSizes)
    .where(and(eq(breadSizes.groupId, groupId), eq(breadSizes.isActive, true)));
  const scope = [...new Set([...activeSizes.map((s) => s.id), ...requestedIds])];
  if (scope.length > 0) {
    await db
      .delete(breadTypeSizes)
      .where(
        and(eq(breadTypeSizes.breadTypeId, typeId), inArray(breadTypeSizes.breadSizeId, scope))
      );
  }

  if (parsed.data.enabled.length > 0) {
    await db.insert(breadTypeSizes).values(
      parsed.data.enabled.map((e, idx) => ({
        breadTypeId: typeId,
        breadSizeId: e.breadSizeId,
        priceOverride: e.priceOverride ?? null,
        badgeType: e.badgeType ?? null,
        badgeLabel: e.badgeLabel ?? null,
        badgeIcon: e.badgeIcon ?? null,
        sortOrder: idx,
      }))
    );
  }

  revalidatePublicSite(groupId);
  return jsonResponse({ success: true, count: parsed.data.enabled.length });
});

const addSchema = z.object({
  breadSizeId: z.number().int().positive(),
});

/**
 * Additively enable a single size for a bread type, appended at the end. Unlike
 * the clean-slate PUT above, this leaves existing enabled sizes and their price
 * overrides untouched — used when an admin creates a size from the order screen.
 */
export const POST = withAuth(async (request, auth) => {
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
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [size] = await db
    .select({ id: breadSizes.id })
    .from(breadSizes)
    .where(and(eq(breadSizes.id, parsed.data.breadSizeId), eq(breadSizes.groupId, groupId)))
    .limit(1);
  if (!size) return errorResponse('Size does not belong to this group', 400);

  const [existing] = await db
    .select({ breadSizeId: breadTypeSizes.breadSizeId })
    .from(breadTypeSizes)
    .where(
      and(
        eq(breadTypeSizes.breadTypeId, typeId),
        eq(breadTypeSizes.breadSizeId, parsed.data.breadSizeId)
      )
    )
    .limit(1);
  if (existing) return jsonResponse({ success: true, alreadyEnabled: true });

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${breadTypeSizes.sortOrder}), -1)` })
    .from(breadTypeSizes)
    .where(eq(breadTypeSizes.breadTypeId, typeId));

  await db.insert(breadTypeSizes).values({
    breadTypeId: typeId,
    breadSizeId: parsed.data.breadSizeId,
    priceOverride: null,
    sortOrder: maxSort + 1,
  });

  revalidatePublicSite(groupId);
  return jsonResponse({ success: true });
});
