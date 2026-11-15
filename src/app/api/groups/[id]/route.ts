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

  // The key's hash never leaves the server; the settings card needs only when it was made.
  const { mcpKeyHash: _hash, ...safeGroup } = group;
  void _hash;
  return jsonResponse({ group: safeGroup, role: membership.role });
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  additionsSurcharge: decimalStr.optional(),
  deliveryEnabled: z.boolean().optional(),
  deliveryHomeCity: z.string().max(255).nullable().optional(),
  deliveryHomeAddress: z.string().max(500).nullable().optional(),
  deliveryFee: decimalStr.optional(),
  deliveryFreeOver: decimalStr.nullable().optional(),
  deliveryCities: z.array(z.string().min(1).max(255)).max(100).optional(),
  recurringRemindersEnabled: z.boolean().optional(),
  asapInToday: z.boolean().optional(),
  kitchenShowRecipe: z.boolean().optional(),
});

const DELIVERY_KEYS = [
  'deliveryEnabled',
  'deliveryHomeCity',
  'deliveryFee',
  'deliveryFreeOver',
  'deliveryCities',
] as const;

// Everything on this row that the storefront renders. Only the delivery block
// used to purge the cache, so renaming the bakery or moving the per-addition
// surcharge from ₪2 to ₪3 left the public pricelist advertising the old figure
// for up to an hour while the order screen already charged the new one.
const PUBLIC_KEYS = ['name', 'additionsSurcharge', ...DELIVERY_KEYS] as const;

export const PATCH = withAuth(async (request, auth) => {
  const groupId = Number(new URL(request.url).pathname.split('/').at(-1));
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);

  const body = await request.json();
  const parsed = updateGroupSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const canManage = membership.role === 'owner' || membership.role === 'manager';
  const touchesDelivery = DELIVERY_KEYS.some((k) => parsed.data[k] !== undefined);
  const touchesPublic = PUBLIC_KEYS.some((k) => parsed.data[k] !== undefined);

  if (parsed.data.name !== undefined && membership.role !== 'owner') {
    return errorResponse('Only owner can edit group name', 403);
  }
  if (parsed.data.additionsSurcharge !== undefined && !canManage) {
    return errorResponse('Only owner or manager can edit pricing', 403);
  }
  if (touchesDelivery && !canManage) {
    return errorResponse('Only owner or manager can edit delivery', 403);
  }
  // Not in DELIVERY_KEYS on purpose: that list feeds PUBLIC_KEYS, and the home
  // address is private (it never reaches the storefront or its cache purge).
  if (parsed.data.deliveryHomeAddress !== undefined && !canManage) {
    return errorResponse('Only owner or manager can edit delivery', 403);
  }
  if (parsed.data.recurringRemindersEnabled !== undefined && !canManage) {
    return errorResponse('Only owner or manager can edit reminders', 403);
  }
  if ((parsed.data.asapInToday !== undefined || parsed.data.kitchenShowRecipe !== undefined) && !canManage) {
    return errorResponse('Only owner or manager can edit order display', 403);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.additionsSurcharge !== undefined) {
    updates.additionsSurcharge = parsed.data.additionsSurcharge;
  }
  if (parsed.data.recurringRemindersEnabled !== undefined) {
    updates.recurringRemindersEnabled = parsed.data.recurringRemindersEnabled;
  }
  if (parsed.data.asapInToday !== undefined) updates.asapInToday = parsed.data.asapInToday;
  if (parsed.data.kitchenShowRecipe !== undefined) updates.kitchenShowRecipe = parsed.data.kitchenShowRecipe;
  // Saving only stores the text; the route endpoint geocodes it lazily and
  // re-looks-up when the text no longer matches the cached query.
  if (parsed.data.deliveryHomeAddress !== undefined) {
    updates.deliveryHomeAddress = parsed.data.deliveryHomeAddress?.trim() || null;
  }
  for (const k of DELIVERY_KEYS) {
    if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
  }

  const [updated] = await db
    .update(groups)
    .set(updates)
    .where(eq(groups.id, groupId))
    .returning();

  if (touchesPublic) revalidatePublicSite(groupId);

  const { mcpKeyHash: _hash, ...safeUpdated } = updated;
  void _hash;
  return jsonResponse({ group: safeUpdated });
});
