import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  buildNextOccurrenceView,
  discardNextChange,
  nextChangeInputSchema,
  saveNextChange,
} from '@/lib/order-next-change';

function getOrderId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  const idx = parts.indexOf('orders');
  return Number(parts[idx + 1]);
}

/** The order's next-occurrence view after a write, so the screen shows what was stored. */
async function viewOf(groupId: number, orderId: number) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.groupId, groupId)))
    .limit(1);
  return order ? buildNextOccurrenceView(order) : null;
}

// Save what the next occurrence of a recurring order should change. Drivers
// can't edit orders, so they can't plan a change either (delivering one still
// applies it — that runs through the shared status transition).
export const PUT = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role === 'driver') return errorResponse('Forbidden', 403);
  const orderId = getOrderId(request.url);

  const parsed = nextChangeInputSchema.safeParse(await request.json());
  if (!parsed.success) return errorResponse(parsed.error.message);

  const result = await saveNextChange(groupId, orderId, parsed.data);
  if (!result.ok) return errorResponse(result.error, result.status);
  return jsonResponse({ nextOccurrence: await viewOf(groupId, orderId) });
});

export const DELETE = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role === 'driver') return errorResponse('Forbidden', 403);
  const orderId = getOrderId(request.url);

  const result = await discardNextChange(groupId, orderId);
  if (!result.ok) return errorResponse(result.error, result.status);
  return jsonResponse({ nextOccurrence: await viewOf(groupId, orderId) });
});
