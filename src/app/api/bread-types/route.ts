import { withGroup, jsonResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadSizes } from '@/db/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';

export const GET = withGroup(async (_request, _auth, groupId) => {
  const types = await db
    .select()
    .from(breadTypes)
    .where(and(eq(breadTypes.groupId, groupId), eq(breadTypes.isActive, true)))
    .orderBy(asc(breadTypes.sortOrder));

  const typeIds = types.map((t) => t.id);
  const sizes = typeIds.length
    ? await db
        .select()
        .from(breadSizes)
        .where(
          and(
            inArray(breadSizes.breadTypeId, typeIds),
            eq(breadSizes.isActive, true)
          )
        )
        .orderBy(asc(breadSizes.sortOrder))
    : [];

  const sizesByType: Record<number, typeof sizes> = {};
  for (const s of sizes) {
    if (!sizesByType[s.breadTypeId]) sizesByType[s.breadTypeId] = [];
    sizesByType[s.breadTypeId].push(s);
  }

  const breadTypesWithSizes = types.map((t) => ({
    ...t,
    sizes: sizesByType[t.id] || [],
  }));

  return jsonResponse({ breadTypes: breadTypesWithSizes });
});
