import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadSizes } from '@/db/schema';
import { eq, asc, sql, inArray } from 'drizzle-orm';
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
  const sizes = typeIds.length
    ? await db
        .select()
        .from(breadSizes)
        .where(inArray(breadSizes.breadTypeId, typeIds))
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

const sizeSchema = z.object({
  name: z.string().min(1).max(100),
  weightGrams: z.number().int().positive().nullable().optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

const createBreadTypeSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  sortOrder: z.number().int().optional(),
  sizes: z.array(sizeSchema).optional(),
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
      // Type-level price is a legacy fallback; default to 0 when sizes are provided
      price: parsed.data.price ?? '0',
      sortOrder: parsed.data.sortOrder ?? maxSort + 1,
    })
    .returning();

  let sizes: (typeof breadSizes.$inferSelect)[] = [];
  if (parsed.data.sizes && parsed.data.sizes.length > 0) {
    sizes = await db
      .insert(breadSizes)
      .values(
        parsed.data.sizes.map((s, idx) => ({
          breadTypeId: breadType.id,
          name: s.name,
          weightGrams: s.weightGrams ?? null,
          price: s.price,
          sortOrder: idx,
        }))
      )
      .returning();
  }

  return jsonResponse({ breadType: { ...breadType, sizes } }, 201);
});
