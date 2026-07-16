import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';
import { transitionOrderStatus } from '@/lib/order-status';

function getOrderId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  const idx = parts.indexOf('orders');
  return Number(parts[idx + 1]);
}

const updateStatusSchema = z.object({
  status: z.enum([
    'pending',
    'confirmed',
    'baking',
    'ready',
    'delivered',
    'cancelled',
  ]),
  notifyCustomer: z.boolean().optional(),
});

export const PATCH = withGroup(async (request, auth, groupId) => {
  const orderId = getOrderId(request.url);
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;

  const body = await request.json();
  const parsed = updateStatusSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.groupId, groupId)))
    .limit(1);

  if (!order) return errorResponse('Order not found', 404);

  // Drivers may only act on delivery orders.
  if (role === 'driver' && !order.isDelivery) return errorResponse('Forbidden', 403);

  const result = await transitionOrderStatus(order, parsed.data.status, {
    notifyCustomer: parsed.data.notifyCustomer,
  });
  if (!result.ok) return errorResponse(result.error, result.status);

  return jsonResponse({ order: result.order, nextRecurringOrderId: result.nextRecurringOrderId });
});
