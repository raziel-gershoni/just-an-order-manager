import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadSizes, breadSizeTiers, breadTypeSizes, orderItems } from '@/db/schema';
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
    // Ask before destroying anything. This used to clear the junction rows
    // first, "so the FK doesn't block the delete" — but order_items has its own
    // FK, and with no transactions here a size used by a past order was refused
    // with a 409 only AFTER every bread had lost its link to it, along with the
    // per-bread price and badges those rows carried. Nothing recreated them.
    const [used] = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.breadSizeId, sizeId))
      .limit(1);
    if (used) {
      return errorResponse(
        'Cannot delete: size is used in existing orders. Disable it instead.',
        409
      );
    }

    // Past this point the size is genuinely deletable. Its tiers and links are
    // worthless without it and both hold a blocking FK, so they go first; an
    // order created in the gap between the check and the delete leaves the size
    // unlinked, which is the same 409 the owner asked for, one round trip late.
    await db.delete(breadSizeTiers).where(eq(breadSizeTiers.breadSizeId, sizeId));
    await db.delete(breadTypeSizes).where(eq(breadTypeSizes.breadSizeId, sizeId));
    try {
      await db.delete(breadSizes).where(eq(breadSizes.id, sizeId));
    } catch {
      revalidatePublicSite(authz.groupId);
      return errorResponse(
        'Cannot delete: size is used in existing orders. Disable it instead.',
        409
      );
    }
    revalidatePublicSite(authz.groupId);
    return jsonResponse({ deleted: true });
  }

  const [updated] = await db
    .update(breadSizes)
    .set({ isActive: false })
    .where(eq(breadSizes.id, sizeId))
    .returning();

  revalidatePublicSite(authz.groupId);
  return jsonResponse({ size: updated });
});
