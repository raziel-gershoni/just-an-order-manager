import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';

const updateBreadTypeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const PATCH = withAuth(async (request, auth) => {
  const breadTypeId = Number(new URL(request.url).pathname.split('/').pop());

  const [breadType] = await db
    .select()
    .from(breadTypes)
    .where(eq(breadTypes.id, breadTypeId))
    .limit(1);

  if (!breadType) return errorResponse('Bread type not found', 404);

  const membership = auth.memberships.find(
    (m) => m.groupId === breadType.groupId
  );
  if (!membership) return errorResponse('Not a member', 403);
  if (membership.role === 'baker') {
    return errorResponse('Bakers cannot manage bread types', 403);
  }

  const body = await request.json();
  const parsed = updateBreadTypeSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [updated] = await db
    .update(breadTypes)
    .set(parsed.data)
    .where(eq(breadTypes.id, breadTypeId))
    .returning();

  return jsonResponse({ breadType: updated });
});

export const DELETE = withAuth(async (request, auth) => {
  const breadTypeId = Number(new URL(request.url).pathname.split('/').pop());

  const [breadType] = await db
    .select()
    .from(breadTypes)
    .where(eq(breadTypes.id, breadTypeId))
    .limit(1);

  if (!breadType) return errorResponse('Bread type not found', 404);

  const membership = auth.memberships.find(
    (m) => m.groupId === breadType.groupId
  );
  if (!membership) return errorResponse('Not a member', 403);
  if (membership.role === 'baker') {
    return errorResponse('Bakers cannot manage bread types', 403);
  }

  // Soft-delete: deactivate instead of deleting (orders may reference it)
  const [updated] = await db
    .update(breadTypes)
    .set({ isActive: false })
    .where(eq(breadTypes.id, breadTypeId))
    .returning();

  return jsonResponse({ breadType: updated });
});
