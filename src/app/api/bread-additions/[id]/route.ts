import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadAdditions, breadTypeAdditions, orderItemAdditions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { revalidatePublicSite } from '@/lib/public-site';

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
): Promise<{ error: Response } | { groupId: number }> {
  const [row] = await db.select().from(breadAdditions).where(eq(breadAdditions.id, id)).limit(1);
  if (!row) return { error: errorResponse('Bread addition not found', 404) };

  const membership = auth.memberships.find((m) => m.groupId === row.groupId);
  if (!membership) return { error: errorResponse('Not a member', 403) };
  if ((membership.role === 'baker' || membership.role === 'driver')) {
    return { error: errorResponse('Bakers cannot manage bread additions', 403) };
  }
  return { groupId: row.groupId };
}

export const PATCH = withAuth(async (request, auth) => {
  const id = getId(request.url);
  const authz = await authorize(id, auth);
  if ('error' in authz) return authz.error;

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [updated] = await db
    .update(breadAdditions)
    .set(parsed.data)
    .where(eq(breadAdditions.id, id))
    .returning();

  // Addition names show on the public modal — purge its cache.
  revalidatePublicSite(authz.groupId);
  return jsonResponse({ addition: updated });
});

export const DELETE = withAuth(async (request, auth) => {
  const id = getId(request.url);
  const authz = await authorize(id, auth);
  if ('error' in authz) return authz.error;

  const url = new URL(request.url);
  const hard = url.searchParams.get('hard') === 'true';

  if (hard) {
    // order_item_additions blocks this delete, and it used to be discovered only
    // after every bread had been unlinked from the addition — the addition then
    // sat in the catalog offered by nothing, while the owner was told the delete
    // had failed. Ask first; unlink only what is actually going away. There is no
    // confirmation dialog on this button, which is the other half of why it hurt.
    const [used] = await db
      .select({ orderItemId: orderItemAdditions.orderItemId })
      .from(orderItemAdditions)
      .where(eq(orderItemAdditions.breadAdditionId, id))
      .limit(1);
    if (used) {
      return errorResponse(
        'Cannot delete: addition is used in existing orders. Disable it instead.',
        409
      );
    }

    await db.delete(breadTypeAdditions).where(eq(breadTypeAdditions.breadAdditionId, id));
    try {
      await db.delete(breadAdditions).where(eq(breadAdditions.id, id));
    } catch {
      revalidatePublicSite(authz.groupId);
      return errorResponse(
        'Cannot delete: addition is used in existing orders. Disable it instead.',
        409
      );
    }
    revalidatePublicSite(authz.groupId);
    return jsonResponse({ deleted: true });
  }

  const [updated] = await db
    .update(breadAdditions)
    .set({ isActive: false })
    .where(eq(breadAdditions.id, id))
    .returning();

  revalidatePublicSite(authz.groupId);
  return jsonResponse({ addition: updated });
});
