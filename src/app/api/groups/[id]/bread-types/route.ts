import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadSizes, breadTypeSizes } from '@/db/schema';
import { eq, asc, sql, inArray, and } from 'drizzle-orm';
import { z } from 'zod/v4';

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
  if (membership.role === 'baker') {
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
  const defaults = await db
    .select()
    .from(breadSizes)
    .where(
      and(
        eq(breadSizes.groupId, groupId),
        eq(breadSizes.isDefault, true),
        eq(breadSizes.isActive, true)
      )
    );

  if (defaults.length > 0) {
    await db.insert(breadTypeSizes).values(
      defaults.map((s, idx) => ({
        breadTypeId: breadType.id,
        breadSizeId: s.id,
        sortOrder: idx,
      }))
    );
  }

  return jsonResponse(
    {
      breadType: {
        ...breadType,
        enabledSizes: defaults.map((s) => ({
          id: s.id,
          name: s.name,
          weightGrams: s.weightGrams,
          price: s.price,
          priceOverride: null,
          isActive: s.isActive,
        })),
      },
    },
    201
  );
});
