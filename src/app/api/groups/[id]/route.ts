import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { groups } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';

export const GET = withAuth(async (_request, auth) => {
  const groupId = Number(new URL(_request.url).pathname.split('/').at(-1));
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);

  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  if (!group) return errorResponse('Group not found', 404);

  return jsonResponse({ group, role: membership.role });
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(255),
});

export const PATCH = withAuth(async (request, auth) => {
  const groupId = Number(new URL(request.url).pathname.split('/').at(-1));
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if (membership.role !== 'owner') return errorResponse('Only owner can edit group', 403);

  const body = await request.json();
  const parsed = updateGroupSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [updated] = await db
    .update(groups)
    .set({ name: parsed.data.name })
    .where(eq(groups.id, groupId))
    .returning();

  return jsonResponse({ group: updated });
});
