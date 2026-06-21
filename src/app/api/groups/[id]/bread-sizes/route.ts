import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadSizes } from '@/db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { z } from 'zod/v4';

export const GET = withAuth(async (request, auth) => {
  const groupId = getGroupId(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);

  const sizes = await db
    .select()
    .from(breadSizes)
    .where(eq(breadSizes.groupId, groupId))
    .orderBy(asc(breadSizes.sortOrder));

  return jsonResponse({ sizes });
});

function getGroupId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  const idx = parts.indexOf('groups');
  return Number(parts[idx + 1]);
}

const createSizeSchema = z.object({
  name: z.string().min(1).max(100),
  weightGrams: z.number().int().positive().nullable().optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  isDefault: z.boolean().optional(),
});

export const POST = withAuth(async (request, auth) => {
  const groupId = getGroupId(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if ((membership.role === 'baker' || membership.role === 'driver')) {
    return errorResponse('Bakers cannot manage bread sizes', 403);
  }

  const body = await request.json();
  const parsed = createSizeSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${breadSizes.sortOrder}), -1)` })
    .from(breadSizes)
    .where(eq(breadSizes.groupId, groupId));

  const [size] = await db
    .insert(breadSizes)
    .values({
      groupId,
      name: parsed.data.name,
      weightGrams: parsed.data.weightGrams ?? null,
      price: parsed.data.price,
      isDefault: parsed.data.isDefault ?? false,
      sortOrder: maxSort + 1,
    })
    .returning();

  return jsonResponse({ size }, 201);
});
