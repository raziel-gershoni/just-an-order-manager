import { withGroup, jsonResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadSizes, breadTypeSizes } from '@/db/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';

export const GET = withGroup(async (_request, _auth, groupId) => {
  const types = await db
    .select()
    .from(breadTypes)
    .where(and(eq(breadTypes.groupId, groupId), eq(breadTypes.isActive, true)))
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

  const enabledByType: Record<number, typeof links> = {};
  for (const link of links) {
    if (!enabledByType[link.breadTypeId]) enabledByType[link.breadTypeId] = [];
    enabledByType[link.breadTypeId].push(link);
  }

  const result = types.map((t) => ({
    ...t,
    enabledSizes: (enabledByType[t.id] ?? []).map((l) => ({
      id: l.breadSizeId,
      name: l.name,
      weightGrams: l.weightGrams,
      // Effective price = override if set, else global default
      price: l.priceOverride ?? l.price,
    })),
  }));

  return jsonResponse({ breadTypes: result });
});
