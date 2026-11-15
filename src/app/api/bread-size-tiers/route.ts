import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadSizeTiers } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { upsertTier } from '@/lib/catalog-writes';

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

  const result = await upsertTier(groupId, { breadSizeId, breadTypeId, minQty, price });
  if (!result.ok) return errorResponse(result.error, result.status);

  return jsonResponse({ tier: result.tier }, 201);
});
