import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadSizes, breadTypeSizes } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { revalidatePublicSite } from '@/lib/public-site';

function getSizeId(url: string): number {
  return Number(new URL(url).pathname.split('/').pop());
}

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  weightGrams: z.number().int().positive().nullable().optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

async function authorizeSize(
  sizeId: number,
  auth: { memberships: { groupId: number; role: string }[] }
): Promise<{ error: Response } | { groupId: number }> {
  const [size] = await db.select().from(breadSizes).where(eq(breadSizes.id, sizeId)).limit(1);
  if (!size) return { error: errorResponse('Bread size not found', 404) };

  const membership = auth.memberships.find((m) => m.groupId === size.groupId);
  if (!membership) return { error: errorResponse('Not a member', 403) };
  if ((membership.role === 'baker' || membership.role === 'driver')) {
    return { error: errorResponse('Bakers cannot manage bread sizes', 403) };
  }
  return { groupId: size.groupId };
}

export const PATCH = withAuth(async (request, auth) => {
  const sizeId = getSizeId(request.url);
  const authz = await authorizeSize(sizeId, auth);
  if ('error' in authz) return authz.error;

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [updated] = await db
    .update(breadSizes)
    .set(parsed.data)
    .where(eq(breadSizes.id, sizeId))
    .returning();

  // Price/name/active edits flow to the public pricelist — purge its cache.
  revalidatePublicSite(authz.groupId);
  return jsonResponse({ size: updated });
});

export const DELETE = withAuth(async (request, auth) => {
  const sizeId = getSizeId(request.url);
  const authz = await authorizeSize(sizeId, auth);
  if ('error' in authz) return authz.error;

  const url = new URL(request.url);
  const hard = url.searchParams.get('hard') === 'true';

  if (hard) {
    // Junction rows reference this size; clear them first so the FK from
    // bread_type_sizes doesn't block the delete. order_items.bread_size_id
    // still has its own FK and will block (correctly) if any order uses it.
    await db.delete(breadTypeSizes).where(eq(breadTypeSizes.breadSizeId, sizeId));
    // The unlink above already removed the size from every type publicly, and
    // there are no transactions here — so purge now, before the row delete that
    // may still 409 on an order FK (the size is gone from the pricelist either way).
    revalidatePublicSite(authz.groupId);
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

  revalidatePublicSite(authz.groupId);
  return jsonResponse({ size: updated });
});
