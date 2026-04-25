import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, breadTypes } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';
import { ORDER_STATUS_TRANSITIONS } from '@/lib/constants';
import { notifyOrderReady, notifyCustomerWhatsApp } from '@/lib/notifications';
import { resolveDeliveryDate } from '@/lib/date-utils';

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

export const PATCH = withGroup(async (request, _auth, groupId) => {
  const orderId = getOrderId(request.url);

  const body = await request.json();
  const parsed = updateStatusSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const newStatus = parsed.data.status;
  const shouldNotify = parsed.data.notifyCustomer !== false;

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

  // Auto-create next recurring order when delivered
  if (newStatus === 'delivered' && order.isRecurring) {
    const items = await db
      .select({
        breadTypeId: orderItems.breadTypeId,
        quantity: orderItems.quantity,
        pricePerUnit: orderItems.pricePerUnit,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    if (items.length > 0) {
      const nextDate = resolveDeliveryDate(order.deliveryType);
      const [nextOrder] = await db
        .insert(orders)
        .values({
          groupId,
          customerId: order.customerId,
          deliveryType: order.deliveryType,
          deliveryDate: nextDate,
          notes: order.notes,
          totalOverride: order.totalOverride,
          isRecurring: true,
        })
        .returning();

      await db.insert(orderItems).values(
        items.map((i) => ({
          orderId: nextOrder.id,
          breadTypeId: i.breadTypeId,
          quantity: i.quantity,
          pricePerUnit: i.pricePerUnit,
        }))
      );
    }
  }

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
      await notifyOrderReady(groupId, orderId, {
        customerName: customer.name,
        itemsSummary: summary,
      });
      if (shouldNotify) await notifyCustomerWhatsApp(customer.phone);
    }
  }

  // Notify customer on cancel
  if (newStatus === 'cancelled' && shouldNotify) {
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, order.customerId))
      .limit(1);
    if (customer?.phone) {
      await notifyCustomerWhatsApp(customer.phone, 'order_cancelled');
    }
  }

  return jsonResponse({ order: updated });
});
