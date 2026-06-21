import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { groups } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { revalidatePublicSite } from '@/lib/public-site';

const decimalStr = z.string().regex(/^\d+(\.\d{1,2})?$/);

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
  name: z.string().min(1).max(255).optional(),
  additionsSurcharge: decimalStr.optional(),
  deliveryEnabled: z.boolean().optional(),
  deliveryHomeCity: z.string().max(255).nullable().optional(),
  deliveryFee: decimalStr.optional(),
  deliveryFreeOver: decimalStr.nullable().optional(),
  deliveryCities: z.array(z.string().min(1).max(255)).max(100).optional(),
});

const DELIVERY_KEYS = [
  'deliveryEnabled',
  'deliveryHomeCity',
  'deliveryFee',
  'deliveryFreeOver',
  'deliveryCities',
] as const;

export const PATCH = withAuth(async (request, auth) => {
  const groupId = Number(new URL(request.url).pathname.split('/').at(-1));
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);

  const body = await request.json();
  const parsed = updateGroupSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const canManage = membership.role === 'owner' || membership.role === 'manager';
  const touchesDelivery = DELIVERY_KEYS.some((k) => parsed.data[k] !== undefined);

  if (parsed.data.name !== undefined && membership.role !== 'owner') {
    return errorResponse('Only owner can edit group name', 403);
  }
  if (parsed.data.additionsSurcharge !== undefined && !canManage) {
    return errorResponse('Only owner or manager can edit pricing', 403);
  }
  if (touchesDelivery && !canManage) {
    return errorResponse('Only owner or manager can edit delivery', 403);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.additionsSurcharge !== undefined) {
    updates.additionsSurcharge = parsed.data.additionsSurcharge;
  }
  for (const k of DELIVERY_KEYS) {
    if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
  }

  const [updated] = await db
    .update(groups)
    .set(updates)
    .where(eq(groups.id, groupId))
    .returning();

  if (touchesDelivery) revalidatePublicSite(groupId);

  return jsonResponse({ group: updated });
});
