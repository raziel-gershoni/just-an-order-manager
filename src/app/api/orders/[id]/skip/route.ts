import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { skipRecurringOccurrence } from '@/lib/order-status';

function getOrderId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  const idx = parts.indexOf('orders');
  return Number(parts[idx + 1]);
}

// Skip this week of a recurring order: cancel it and make the next one now.
// Drivers deliver but don't edit orders, so they don't reshape a repeat either.
export const POST = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role === 'driver') return errorResponse('Forbidden', 403);
  const orderId = getOrderId(request.url);

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.groupId, groupId)))
    .limit(1);
  if (!order) return errorResponse('Order not found', 404);

  const result = await skipRecurringOccurrence(order);
  if (!result.ok) return errorResponse(result.error, result.status);

  return jsonResponse({ order: result.order, nextRecurringOrderId: result.nextRecurringOrderId });
});
