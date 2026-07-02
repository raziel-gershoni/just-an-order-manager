import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadSizeTiers, breadSizes, breadTypes } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod/v4';

export const GET = withGroup(async (_request, _auth, groupId) => {
  const tiers = await db
    .select()
    .from(breadSizeTiers)
    .where(eq(breadSizeTiers.groupId, groupId));
  return jsonResponse({ tiers });
});

const upsertSchema = z.object({
  breadSizeId: z.number().int().positive(),
  breadTypeId: z.number().int().positive().nullable(), // null = size-wide default
  minQty: z.number().int().min(2),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export const POST = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role !== 'owner' && role !== 'manager') return errorResponse('Forbidden', 403);

  const body = await request.json();
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);
  const { breadSizeId, breadTypeId, minQty, price } = parsed.data;

  const [size] = await db
    .select({ id: breadSizes.id })
    .from(breadSizes)
    .where(and(eq(breadSizes.id, breadSizeId), eq(breadSizes.groupId, groupId)))
    .limit(1);
  if (!size) return errorResponse('Size not found', 404);

  if (breadTypeId != null) {
    const [type] = await db
      .select({ id: breadTypes.id })
      .from(breadTypes)
      .where(and(eq(breadTypes.id, breadTypeId), eq(breadTypes.groupId, groupId)))
      .limit(1);
    if (!type) return errorResponse('Type not found', 404);
  }

  // Idempotent upsert: clear any existing row for this exact tuple, then insert.
  // Handles the null-breadTypeId "default" case, which a unique index can't
  // dedupe because SQL treats NULLs as distinct.
  const typeCond =
    breadTypeId == null
      ? sql`${breadSizeTiers.breadTypeId} IS NULL`
      : eq(breadSizeTiers.breadTypeId, breadTypeId);
  await db
    .delete(breadSizeTiers)
    .where(
      and(
        eq(breadSizeTiers.groupId, groupId),
        eq(breadSizeTiers.breadSizeId, breadSizeId),
        typeCond,
        eq(breadSizeTiers.minQty, minQty)
      )
    );
  const [row] = await db
    .insert(breadSizeTiers)
    .values({ groupId, breadSizeId, breadTypeId, minQty, price })
    .returning();

  return jsonResponse({ tier: row }, 201);
});
