import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadAdditions, breadTypeAdditions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';

function getId(url: string): number {
  return Number(new URL(url).pathname.split('/').pop());
}

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

async function authorize(
  id: number,
  auth: { memberships: { groupId: number; role: string }[] }
): Promise<Response | null> {
  const [row] = await db.select().from(breadAdditions).where(eq(breadAdditions.id, id)).limit(1);
  if (!row) return errorResponse('Bread addition not found', 404);

  const membership = auth.memberships.find((m) => m.groupId === row.groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if ((membership.role === 'baker' || membership.role === 'driver')) {
    return errorResponse('Bakers cannot manage bread additions', 403);
  }
  return null;
}

export const PATCH = withAuth(async (request, auth) => {
  const id = getId(request.url);
  const denied = await authorize(id, auth);
  if (denied) return denied;

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [updated] = await db
    .update(breadAdditions)
    .set(parsed.data)
    .where(eq(breadAdditions.id, id))
    .returning();

  return jsonResponse({ addition: updated });
});

export const DELETE = withAuth(async (request, auth) => {
  const id = getId(request.url);
  const denied = await authorize(id, auth);
  if (denied) return denied;

  const url = new URL(request.url);
  const hard = url.searchParams.get('hard') === 'true';

  if (hard) {
    // Junction rows on bread_type_additions reference this; clear them first.
    // order_item_additions still has its own FK and will block (correctly) if any
    // historical order line item used this addition.
    await db.delete(breadTypeAdditions).where(eq(breadTypeAdditions.breadAdditionId, id));
    try {
      await db.delete(breadAdditions).where(eq(breadAdditions.id, id));
      return jsonResponse({ deleted: true });
    } catch {
      return errorResponse(
        'Cannot delete: addition is used in existing orders. Disable it instead.',
        409
      );
    }
  }

  const [updated] = await db
    .update(breadAdditions)
    .set({ isActive: false })
    .where(eq(breadAdditions.id, id))
    .returning();

  return jsonResponse({ addition: updated });
});
