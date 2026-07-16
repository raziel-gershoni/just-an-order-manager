import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, breadTypes, breadSizes, breadAdditions, orderItemAdditions } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { formatItemLineForStaff } from '@/lib/order-display';
import { z } from 'zod/v4';
import { ORDER_STATUS_TRANSITIONS } from '@/lib/constants';
import { notifyOrderReady, notifyCustomerWhatsApp } from '@/lib/notifications';
import { getCustomerPhones } from '@/lib/customer-phones';
import { nextRecurringDate } from '@/lib/date-utils';
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

  // Atomic compare-and-swap: only the request that actually flips the status
  // away from the value we just read runs the delivery side effects (charge +
  // recurring clone). A concurrent double-"delivered" (double tap / retry) loses
  // the race here and returns 409 instead of double-charging or double-cloning.
  // neon-http has no interactive transactions, so this conditional UPDATE is our
  // serialization point.
  const [updated] = await db
    .update(orders)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.status, order.status)))
    .returning();

  if (!updated) {
    return errorResponse('Order was already updated, please refresh', 409);
  }

  // Record the charge as soon as the order is delivered, regardless of how
  // (or whether) the user follows up via the payment dialog. Idempotent, and
  // best-effort: the 'delivered' status is already committed (terminal — no
  // retry can re-enter this handler), so a transient charge failure must be
  // logged rather than thrown, or it would 500 the request AND skip the
  // recurring clone below. A later manual payment still creates the charge.
  if (newStatus === 'delivered') {
    try {
      await ensureOrderCharge(orderId, groupId, order.customerId);
    } catch (err) {
      console.error(`Failed to ensure charge after delivering order ${orderId}:`, err);
    }
  }

  // Auto-create the next recurring order once this one is delivered. Best-effort:
  // the delivery + charge above are already committed, so a clone failure is
  // logged rather than thrown (throwing would 500 a completed delivery, and
  // neon-http has no interactive transaction to bind them together).
  if (newStatus === 'delivered' && order.isRecurring) {
    // Tracked so the catch can unwind a partially-inserted clone (neon-http
    // auto-commits each insert separately — no transaction to roll back).
    let createdOrderId: number | null = null;
    try {
      const items = await db
        .select({
          id: orderItems.id,
          breadTypeId: orderItems.breadTypeId,
          breadSizeId: orderItems.breadSizeId,
          quantity: orderItems.quantity,
          pricePerUnit: orderItems.pricePerUnit,
          additionsCharged: orderItems.additionsCharged,
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

        // Weekly cadence: advance this order's own delivery date by 7 days.
        const nextDate = nextRecurringDate(order.deliveryType, order.deliveryDate);
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
            // Carry delivery status + fee so a recurring delivery order doesn't
            // silently regenerate as a fee-less pickup.
            isDelivery: order.isDelivery,
            deliveryFee: order.deliveryFee,
            // Items are copied verbatim, so the frozen pricing carries over too.
            dealsEnabled: order.dealsEnabled,
            additionsCharged: order.additionsCharged,
            goodsSnapshot: order.goodsSnapshot,
            pricingBreakdown: order.pricingBreakdown,
          })
          .returning();
        createdOrderId = nextOrder.id;

        const newItems = await db.insert(orderItems).values(
          items.map((i) => ({
            orderId: nextOrder.id,
            breadTypeId: i.breadTypeId,
            breadSizeId: i.breadSizeId,
            quantity: i.quantity,
            pricePerUnit: i.pricePerUnit,
            additionsCharged: i.additionsCharged,
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
    } catch (err) {
      console.error(
        `Failed to create next recurring order after delivering order ${orderId}:`,
        err
      );
      // Unwind a half-inserted clone (a committed order row with no items would
      // otherwise surface in lists as a phantom priced order). Reverse-FK order;
      // itself best-effort.
      if (createdOrderId != null) {
        try {
          const orphanItems = await db
            .select({ id: orderItems.id })
            .from(orderItems)
            .where(eq(orderItems.orderId, createdOrderId));
          if (orphanItems.length > 0) {
            await db
              .delete(orderItemAdditions)
              .where(inArray(orderItemAdditions.orderItemId, orphanItems.map((i) => i.id)));
            await db.delete(orderItems).where(eq(orderItems.orderId, createdOrderId));
          }
          await db.delete(orders).where(eq(orders.id, createdOrderId));
        } catch (cleanupErr) {
          console.error(`Failed to clean up partial recurring clone ${createdOrderId}:`, cleanupErr);
        }
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
