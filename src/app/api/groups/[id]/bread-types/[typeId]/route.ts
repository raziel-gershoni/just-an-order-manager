import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadSizes, breadTypeSizes } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';

function parsePath(url: string): { groupId: number; typeId: number } {
  const parts = new URL(url).pathname.split('/');
  const gIdx = parts.indexOf('groups');
  const tIdx = parts.indexOf('bread-types');
  return {
    groupId: Number(parts[gIdx + 1]),
    typeId: Number(parts[tIdx + 1]),
  };
}

export const GET = withAuth(async (request, auth) => {
  const { groupId, typeId } = parsePath(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);

  const [breadType] = await db
    .select()
    .from(breadTypes)
    .where(and(eq(breadTypes.id, typeId), eq(breadTypes.groupId, groupId)))
    .limit(1);
  if (!breadType) return errorResponse('Bread type not found', 404);

  // All active global sizes available in this group (whether enabled or not for this type)
  const allSizes = await db
    .select()
    .from(breadSizes)
    .where(and(eq(breadSizes.groupId, groupId), eq(breadSizes.isActive, true)))
    .orderBy(asc(breadSizes.sortOrder));

  const enabledLinks = await db
    .select()
    .from(breadTypeSizes)
    .where(eq(breadTypeSizes.breadTypeId, typeId));

  const enabledMap = new Map(enabledLinks.map((l) => [l.breadSizeId, l]));

  const sizes = allSizes.map((s) => {
    const link = enabledMap.get(s.id);
    return {
      id: s.id,
      name: s.name,
      weightGrams: s.weightGrams,
      price: s.price,
      isDefault: s.isDefault,
      enabled: !!link,
      priceOverride: link?.priceOverride ?? null,
    };
  });

  return jsonResponse({ breadType: { ...breadType, sizes } });
});
