import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import {
  breadSizeTiers,
  breadTypeAdditions,
  breadTypes,
  breadTypeSizes,
  orderItems,
} from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { revalidatePublicSite } from '@/lib/public-site';

const updateBreadTypeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  // Public-site fields
  badgeType: z.string().max(20).nullable().optional(),
  badgeLabel: z.string().max(40).nullable().optional(),
  badgeIcon: z.string().max(20).nullable().optional(),
  imageId: z.number().int().nullable().optional(),
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
  if ((membership.role === 'baker' || membership.role === 'driver')) {
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

  revalidatePublicSite(breadType.groupId);
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
  if ((membership.role === 'baker' || membership.role === 'driver')) {
    return errorResponse('Bakers cannot manage bread types', 403);
  }

  const url = new URL(request.url);
  const hard = url.searchParams.get('hard') === 'true';

  if (hard) {
    // Ask before destroying anything. This used to clear the size links first "so
    // the FK doesn't block the delete", but three other tables block it too —
    // order_items, bread_type_additions and bread_size_tiers, all no-action. A
    // new bread type auto-links every default addition, so the delete was refused
    // for practically every bread in the catalog — after its sizes, per-bread
    // prices, badges and sort order had already been thrown away. Nothing
    // recreated them, and the owner was told the delete had failed.
    const [used] = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.breadTypeId, breadTypeId))
      .limit(1);
    if (used) {
      return errorResponse('Cannot delete: bread type is used in existing orders. Disable it instead.', 409);
    }

    // Nothing historical depends on it, so the catalog rows that only exist to
    // describe it go with it. bread_recipes cascades on its own.
    await db.delete(breadSizeTiers).where(eq(breadSizeTiers.breadTypeId, breadTypeId));
    await db.delete(breadTypeAdditions).where(eq(breadTypeAdditions.breadTypeId, breadTypeId));
    await db.delete(breadTypeSizes).where(eq(breadTypeSizes.breadTypeId, breadTypeId));
    try {
      await db.delete(breadTypes).where(eq(breadTypes.id, breadTypeId));
    } catch {
      // An order placed in the gap between the check and here: the type is
      // unlinked but still listed, which is the 409 the owner asked for.
      revalidatePublicSite(breadType.groupId);
      return errorResponse('Cannot delete: bread type is used in existing orders. Disable it instead.', 409);
    }
    revalidatePublicSite(breadType.groupId);
    return jsonResponse({ deleted: true });
  }

  // Soft-delete: deactivate instead of deleting
  const [updated] = await db
    .update(breadTypes)
    .set({ isActive: false })
    .where(eq(breadTypes.id, breadTypeId))
    .returning();

  revalidatePublicSite(breadType.groupId);
  return jsonResponse({ breadType: updated });
});
