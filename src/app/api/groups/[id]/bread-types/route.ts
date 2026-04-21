import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes } from '@/db/schema';
import { eq, asc, sql } from 'drizzle-orm';
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

  return jsonResponse({ breadTypes: types });
});

const createBreadTypeSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  sortOrder: z.number().int().optional(),
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
      price: parsed.data.price,
      sortOrder: parsed.data.sortOrder ?? maxSort + 1,
    })
    .returning();

  return jsonResponse({ breadType }, 201);
});
