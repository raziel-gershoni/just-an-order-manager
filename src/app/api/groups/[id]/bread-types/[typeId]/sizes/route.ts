import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadSizes } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
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

const createSizeSchema = z.object({
  name: z.string().min(1).max(100),
  weightGrams: z.number().int().positive().nullable().optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  sortOrder: z.number().int().optional(),
});

export const POST = withAuth(async (request, auth) => {
  const { groupId, typeId } = parsePath(request.url);

  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if (membership.role === 'baker') {
    return errorResponse('Bakers cannot manage bread sizes', 403);
  }

  // Verify the bread type belongs to this group
  const [breadType] = await db
    .select()
    .from(breadTypes)
    .where(and(eq(breadTypes.id, typeId), eq(breadTypes.groupId, groupId)))
    .limit(1);
  if (!breadType) return errorResponse('Bread type not found', 404);

  const body = await request.json();
  const parsed = createSizeSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${breadSizes.sortOrder}), -1)` })
    .from(breadSizes)
    .where(eq(breadSizes.breadTypeId, typeId));

  const [size] = await db
    .insert(breadSizes)
    .values({
      breadTypeId: typeId,
      name: parsed.data.name,
      weightGrams: parsed.data.weightGrams ?? null,
      price: parsed.data.price,
      sortOrder: parsed.data.sortOrder ?? maxSort + 1,
    })
    .returning();

  return jsonResponse({ size }, 201);
});
