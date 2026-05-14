import { withGroup, jsonResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadSizes, breadTypeSizes, breadAdditions, breadTypeAdditions } from '@/db/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';

export const GET = withGroup(async (_request, _auth, groupId) => {
  const types = await db
    .select()
    .from(breadTypes)
    .where(and(eq(breadTypes.groupId, groupId), eq(breadTypes.isActive, true)))
    .orderBy(asc(breadTypes.sortOrder));

  const typeIds = types.map((t) => t.id);

  const sizeLinks = typeIds.length
    ? await db
        .select({
          breadTypeId: breadTypeSizes.breadTypeId,
          breadSizeId: breadSizes.id,
          name: breadSizes.name,
          weightGrams: breadSizes.weightGrams,
          price: breadSizes.price,
          priceOverride: breadTypeSizes.priceOverride,
          sortOrder: breadTypeSizes.sortOrder,
        })
        .from(breadTypeSizes)
        .innerJoin(breadSizes, eq(breadTypeSizes.breadSizeId, breadSizes.id))
        .where(
          and(
            inArray(breadTypeSizes.breadTypeId, typeIds),
            eq(breadSizes.isActive, true)
          )
        )
        .orderBy(asc(breadTypeSizes.sortOrder))
    : [];

  const sizesByType: Record<number, typeof sizeLinks> = {};
  for (const link of sizeLinks) {
    if (!sizesByType[link.breadTypeId]) sizesByType[link.breadTypeId] = [];
    sizesByType[link.breadTypeId].push(link);
  }

  const additionLinks = typeIds.length
    ? await db
        .select({
          breadTypeId: breadTypeAdditions.breadTypeId,
          breadAdditionId: breadAdditions.id,
          name: breadAdditions.name,
          sortOrder: breadTypeAdditions.sortOrder,
        })
        .from(breadTypeAdditions)
        .innerJoin(breadAdditions, eq(breadTypeAdditions.breadAdditionId, breadAdditions.id))
        .where(
          and(
            inArray(breadTypeAdditions.breadTypeId, typeIds),
            eq(breadAdditions.isActive, true)
          )
        )
        .orderBy(asc(breadTypeAdditions.sortOrder))
    : [];

  const additionsByType: Record<number, typeof additionLinks> = {};
  for (const link of additionLinks) {
    if (!additionsByType[link.breadTypeId]) additionsByType[link.breadTypeId] = [];
    additionsByType[link.breadTypeId].push(link);
  }

  const result = types.map((t) => ({
    ...t,
    enabledSizes: (sizesByType[t.id] ?? []).map((l) => ({
      id: l.breadSizeId,
      name: l.name,
      weightGrams: l.weightGrams,
      price: l.priceOverride ?? l.price,
    })),
    enabledAdditions: (additionsByType[t.id] ?? []).map((l) => ({
      id: l.breadAdditionId,
      name: l.name,
    })),
  }));

  return jsonResponse({ breadTypes: result });
});
