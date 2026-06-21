import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadAdditions } from '@/db/schema';
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

  const additions = await db
    .select()
    .from(breadAdditions)
    .where(eq(breadAdditions.groupId, groupId))
    .orderBy(asc(breadAdditions.sortOrder));

  return jsonResponse({ additions });
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  isDefault: z.boolean().optional(),
});

export const POST = withAuth(async (request, auth) => {
  const groupId = getGroupId(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if ((membership.role === 'baker' || membership.role === 'driver')) {
    return errorResponse('Bakers cannot manage bread additions', 403);
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${breadAdditions.sortOrder}), -1)` })
    .from(breadAdditions)
    .where(eq(breadAdditions.groupId, groupId));

  const [addition] = await db
    .insert(breadAdditions)
    .values({
      groupId,
      name: parsed.data.name.trim(),
      isDefault: parsed.data.isDefault ?? false,
      sortOrder: maxSort + 1,
    })
    .returning();

  return jsonResponse({ addition }, 201);
});
