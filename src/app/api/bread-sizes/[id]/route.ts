import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadSizes, breadTypes } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';

function getSizeId(url: string): number {
  return Number(new URL(url).pathname.split('/').pop());
}

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  weightGrams: z.number().int().positive().nullable().optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

async function authorizeSize(
  sizeId: number,
  auth: { memberships: { groupId: number; role: string }[] }
): Promise<Response | null> {
  const [size] = await db.select().from(breadSizes).where(eq(breadSizes.id, sizeId)).limit(1);
  if (!size) return errorResponse('Bread size not found', 404);

  const [parent] = await db
    .select({ groupId: breadTypes.groupId })
    .from(breadTypes)
    .where(eq(breadTypes.id, size.breadTypeId))
    .limit(1);
  if (!parent) return errorResponse('Parent bread type not found', 404);

  const membership = auth.memberships.find((m) => m.groupId === parent.groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if (membership.role === 'baker') {
    return errorResponse('Bakers cannot manage bread sizes', 403);
  }
  return null;
}

export const PATCH = withAuth(async (request, auth) => {
  const sizeId = getSizeId(request.url);
  const denied = await authorizeSize(sizeId, auth);
  if (denied) return denied;

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [updated] = await db
    .update(breadSizes)
    .set(parsed.data)
    .where(eq(breadSizes.id, sizeId))
    .returning();

  return jsonResponse({ size: updated });
});

export const DELETE = withAuth(async (request, auth) => {
  const sizeId = getSizeId(request.url);
  const denied = await authorizeSize(sizeId, auth);
  if (denied) return denied;

  const url = new URL(request.url);
  const hard = url.searchParams.get('hard') === 'true';

  if (hard) {
    try {
      await db.delete(breadSizes).where(eq(breadSizes.id, sizeId));
      return jsonResponse({ deleted: true });
    } catch {
      return errorResponse(
        'Cannot delete: size is used in existing orders. Disable it instead.',
        409
      );
    }
  }

  const [updated] = await db
    .update(breadSizes)
    .set({ isActive: false })
    .where(eq(breadSizes.id, sizeId))
    .returning();

  return jsonResponse({ size: updated });
});
