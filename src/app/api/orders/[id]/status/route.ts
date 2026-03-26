import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, breadTypes } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';
import { ORDER_STATUS_TRANSITIONS } from '@/lib/constants';
import { notifyOrderReady } from '@/lib/notifications';

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
});

export const PATCH = withGroup(async (request, _auth, groupId) => {
  const orderId = getOrderId(request.url);

  const body = await request.json();
  const parsed = updateStatusSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const newStatus = parsed.data.status;

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.groupId, groupId)))
    .limit(1);

  if (!order) return errorResponse('Order not found', 404);

  const allowed = ORDER_STATUS_TRANSITIONS[order.status];
  if (!allowed?.includes(newStatus)) {
    return errorResponse(
      `Cannot transition from ${order.status} to ${newStatus}`,
      400
    );
  }

  const [updated] = await db
    .update(orders)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(orders.id, orderId))
    .returning();

  // Notify on ready
  if (newStatus === 'ready') {
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, order.customerId))
      .limit(1);

    const items = await db
      .select({
        breadTypeName: breadTypes.name,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
      .where(eq(orderItems.orderId, orderId));

    if (customer) {
      const summary = items.map((i) => `${i.quantity} ${i.breadTypeName}`).join(', ');
      await notifyOrderReady(groupId, {
        customerName: customer.name,
        itemsSummary: summary,
      });
    }
  }

  return jsonResponse({ order: updated });
});
