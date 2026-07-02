import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, breadTypes, breadSizes, breadAdditions, orderItemAdditions } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { formatItemLineForStaff } from '@/lib/order-display';
import { z } from 'zod/v4';
import { ORDER_STATUS_TRANSITIONS } from '@/lib/constants';
import { notifyOrderReady, notifyCustomerWhatsApp } from '@/lib/notifications';
import { getCustomerPhones } from '@/lib/customer-phones';
import { resolveDeliveryDate } from '@/lib/date-utils';
import { ensureOrderCharge } from '@/lib/order-payments';

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

  const newStatus = parsed.data.status;
  const shouldNotify = parsed.data.notifyCustomer !== false;

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.groupId, groupId)))
    .limit(1);

  if (!order) return errorResponse('Order not found', 404);

  // Drivers may only act on delivery orders.
  if (role === 'driver' && !order.isDelivery) return errorResponse('Forbidden', 403);

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

  // Record the charge as soon as the order is delivered, regardless of how
  // (or whether) the user follows up via the payment dialog. Idempotent.
  if (newStatus === 'delivered') {
    await ensureOrderCharge(orderId, groupId, order.customerId);
  }

  // Auto-create next recurring order when delivered
  if (newStatus === 'delivered' && order.isRecurring) {
    const items = await db
      .select({
        id: orderItems.id,
        breadTypeId: orderItems.breadTypeId,
        breadSizeId: orderItems.breadSizeId,
        quantity: orderItems.quantity,
        pricePerUnit: orderItems.pricePerUnit,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    if (items.length > 0) {
      // Fetch additions to copy along, keyed by old item id
      const oldItemIds = items.map((i) => i.id);
      const additionLinks = await db
        .select()
        .from(orderItemAdditions)
        .where(inArray(orderItemAdditions.orderItemId, oldItemIds));
      const additionsByOldItem: Record<number, number[]> = {};
      for (const a of additionLinks) {
        if (!additionsByOldItem[a.orderItemId]) additionsByOldItem[a.orderItemId] = [];
        additionsByOldItem[a.orderItemId].push(a.breadAdditionId);
      }

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
          // Items are copied verbatim, so the frozen pricing carries over too.
          dealsEnabled: order.dealsEnabled,
          goodsSnapshot: order.goodsSnapshot,
          pricingBreakdown: order.pricingBreakdown,
        })
        .returning();

      const newItems = await db.insert(orderItems).values(
        items.map((i) => ({
          orderId: nextOrder.id,
          breadTypeId: i.breadTypeId,
          breadSizeId: i.breadSizeId,
          quantity: i.quantity,
          pricePerUnit: i.pricePerUnit,
        }))
      ).returning();

      // Copy each item's additions onto the new item rows in the same order
      const newAdditionRows: { orderItemId: number; breadAdditionId: number }[] = [];
      for (let i = 0; i < items.length; i++) {
        const oldItemId = items[i].id;
        const newItemId = newItems[i].id;
        for (const aid of additionsByOldItem[oldItemId] ?? []) {
          newAdditionRows.push({ orderItemId: newItemId, breadAdditionId: aid });
        }
      }
      if (newAdditionRows.length > 0) {
        await db.insert(orderItemAdditions).values(newAdditionRows);
      }
    }
  }

  // Notify on ready
  if (newStatus === 'ready') {
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, order.customerId))
      .limit(1);

    const itemRows = await db
      .select({
        id: orderItems.id,
        breadTypeName: breadTypes.name,
        sizeName: breadSizes.name,
        weightGrams: breadSizes.weightGrams,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
      .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
      .where(eq(orderItems.orderId, orderId));

    const itemIds = itemRows.map((i) => i.id);
    const additionLinks = itemIds.length
      ? await db
          .select({ orderItemId: orderItemAdditions.orderItemId, name: breadAdditions.name })
          .from(orderItemAdditions)
          .innerJoin(breadAdditions, eq(orderItemAdditions.breadAdditionId, breadAdditions.id))
          .where(inArray(orderItemAdditions.orderItemId, itemIds))
      : [];
    const additionsByItem: Record<number, string[]> = {};
    for (const a of additionLinks) {
      if (!additionsByItem[a.orderItemId]) additionsByItem[a.orderItemId] = [];
      additionsByItem[a.orderItemId].push(a.name);
    }

    if (customer) {
      const summary = itemRows
        .map((i) => formatItemLineForStaff(i.quantity, i.breadTypeName, i.sizeName, i.weightGrams, additionsByItem[i.id]))
        .join(', ');
      await notifyOrderReady(groupId, orderId, {
        customerName: customer.name,
        itemsSummary: summary,
      });
      if (shouldNotify) {
        const phones = await getCustomerPhones(order.customerId);
        await notifyCustomerWhatsApp(phones);
      }
    }
  }

  // Notify customer on cancel
  if (newStatus === 'cancelled' && shouldNotify) {
    const phones = await getCustomerPhones(order.customerId);
    await notifyCustomerWhatsApp(phones, 'order_cancelled');
  }

  return jsonResponse({ order: updated });
});
