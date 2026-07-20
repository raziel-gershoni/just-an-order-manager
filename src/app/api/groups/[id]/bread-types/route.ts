import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadSizes, breadTypeSizes, breadAdditions, breadTypeAdditions } from '@/db/schema';
import { eq, asc, sql, inArray, and } from 'drizzle-orm';
import { z } from 'zod/v4';
import { revalidatePublicSite } from '@/lib/public-site';

function getGroupId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  const idx = parts.indexOf('groups');
  return Number(parts[idx + 1]);
}

export const GET = withAuth(async (request, auth) => {
  const groupId = getGroupId(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);

  const types = await db
    .select()
    .from(breadTypes)
    .where(eq(breadTypes.groupId, groupId))
    .orderBy(asc(breadTypes.sortOrder));

  const typeIds = types.map((t) => t.id);
  const links = typeIds.length
    ? await db
        .select({
          breadTypeId: breadTypeSizes.breadTypeId,
          breadSizeId: breadSizes.id,
          name: breadSizes.name,
          weightGrams: breadSizes.weightGrams,
          price: breadSizes.price,
          isDefault: breadSizes.isDefault,
          isActive: breadSizes.isActive,
          sortOrder: breadSizes.sortOrder,
          priceOverride: breadTypeSizes.priceOverride,
          junctionSortOrder: breadTypeSizes.sortOrder,
        })
        .from(breadTypeSizes)
        .innerJoin(breadSizes, eq(breadTypeSizes.breadSizeId, breadSizes.id))
        .where(inArray(breadTypeSizes.breadTypeId, typeIds))
        .orderBy(asc(breadTypeSizes.sortOrder), asc(breadSizes.sortOrder))
    : [];

  const enabledByType: Record<number, typeof links> = {};
  for (const link of links) {
    if (!enabledByType[link.breadTypeId]) enabledByType[link.breadTypeId] = [];
    enabledByType[link.breadTypeId].push(link);
  }

  // Additions opt-in per type
  const additionLinks = typeIds.length
    ? await db
        .select({
          breadTypeId: breadTypeAdditions.breadTypeId,
          breadAdditionId: breadAdditions.id,
          name: breadAdditions.name,
          isActive: breadAdditions.isActive,
          junctionSortOrder: breadTypeAdditions.sortOrder,
        })
        .from(breadTypeAdditions)
        .innerJoin(breadAdditions, eq(breadTypeAdditions.breadAdditionId, breadAdditions.id))
        .where(inArray(breadTypeAdditions.breadTypeId, typeIds))
        .orderBy(asc(breadTypeAdditions.sortOrder), asc(breadAdditions.sortOrder))
    : [];

  const additionsByType: Record<number, typeof additionLinks> = {};
  for (const l of additionLinks) {
    if (!additionsByType[l.breadTypeId]) additionsByType[l.breadTypeId] = [];
    additionsByType[l.breadTypeId].push(l);
  }

  const breadTypesWithSizes = types.map((t) => ({
    ...t,
    enabledSizes: (enabledByType[t.id] ?? []).map((l) => ({
      id: l.breadSizeId,
      name: l.name,
      weightGrams: l.weightGrams,
      price: l.price,
      priceOverride: l.priceOverride,
      isActive: l.isActive,
    })),
    enabledAdditions: (additionsByType[t.id] ?? []).map((l) => ({
      id: l.breadAdditionId,
      name: l.name,
      isActive: l.isActive,
    })),
  }));

  return jsonResponse({ breadTypes: breadTypesWithSizes });
});

const createBreadTypeSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
});

export const POST = withAuth(async (request, auth) => {
  const groupId = getGroupId(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if ((membership.role === 'baker' || membership.role === 'driver')) {
    return errorResponse('Bakers cannot manage bread types', 403);
  }

  const body = await request.json();
  const parsed = createBreadTypeSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${breadTypes.sortOrder}), -1)` })
    .from(breadTypes)
    .where(eq(breadTypes.groupId, groupId));

  const [breadType] = await db
    .insert(breadTypes)
    .values({
      groupId,
      name: parsed.data.name,
      description: parsed.data.description,
      sortOrder: maxSort + 1,
    })
    .returning();

  // Auto-enable any default global sizes for this fresh type
  const sizeDefaults = await db
    .select()
    .from(breadSizes)
    .where(
      and(
        eq(breadSizes.groupId, groupId),
        eq(breadSizes.isDefault, true),
        eq(breadSizes.isActive, true)
      )
    );

  if (sizeDefaults.length > 0) {
    await db.insert(breadTypeSizes).values(
      sizeDefaults.map((s, idx) => ({
        breadTypeId: breadType.id,
        breadSizeId: s.id,
        sortOrder: idx,
      }))
    );
  }

  // Auto-enable any default global additions for this fresh type
  const additionDefaults = await db
    .select()
    .from(breadAdditions)
    .where(
      and(
        eq(breadAdditions.groupId, groupId),
        eq(breadAdditions.isDefault, true),
        eq(breadAdditions.isActive, true)
      )
    );

  if (additionDefaults.length > 0) {
    await db.insert(breadTypeAdditions).values(
      additionDefaults.map((a, idx) => ({
        breadTypeId: breadType.id,
        breadAdditionId: a.id,
        sortOrder: idx,
      }))
    );
  }

  // A fresh active type (with its auto-enabled default sizes) shows on the
  // public pricelist immediately — purge its cache.
  revalidatePublicSite(groupId);
  return jsonResponse(
    {
      breadType: {
        ...breadType,
        enabledSizes: sizeDefaults.map((s) => ({
          id: s.id,
          name: s.name,
          weightGrams: s.weightGrams,
          price: s.price,
          priceOverride: null,
          isActive: s.isActive,
        })),
        enabledAdditions: additionDefaults.map((a) => ({
          id: a.id,
          name: a.name,
          isActive: a.isActive,
        })),
      },
    },
    201
  );
});
