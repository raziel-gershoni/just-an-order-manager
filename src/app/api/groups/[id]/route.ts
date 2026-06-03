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

const updateGroupSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    additionsSurcharge: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .optional(),
  })
  .refine((d) => d.name !== undefined || d.additionsSurcharge !== undefined, {
    message: 'At least one field must be provided',
  });

export const PATCH = withAuth(async (request, auth) => {
  const groupId = Number(new URL(request.url).pathname.split('/').at(-1));
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);

  const body = await request.json();
  const parsed = updateGroupSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  if (parsed.data.name !== undefined && membership.role !== 'owner') {
    return errorResponse('Only owner can edit group name', 403);
  }
  if (
    parsed.data.additionsSurcharge !== undefined &&
    membership.role !== 'owner' &&
    membership.role !== 'manager'
  ) {
    return errorResponse('Only owner or manager can edit pricing', 403);
  }

  const updates: { name?: string; additionsSurcharge?: string } = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.additionsSurcharge !== undefined) {
    updates.additionsSurcharge = parsed.data.additionsSurcharge;
  }

  const [updated] = await db
    .update(groups)
    .set(updates)
    .where(eq(groups.id, groupId))
    .returning();

  return jsonResponse({ group: updated });
});
