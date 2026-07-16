import { db } from '@/db';
import {
  orders,
  orderItems,
  customers,
  breadTypes,
  breadSizes,
  breadAdditions,
  orderItemAdditions,
} from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { ORDER_STATUS_TRANSITIONS } from './constants';
import { formatItemLineForStaff } from './order-display';
import { notifyOrderReady, notifyCustomerWhatsApp } from './notifications';
import { getCustomerPhones } from './customer-phones';
import { ensureOrderCharge } from './order-payments';
import { createNextRecurringOrder } from './order-recurring';

type OrderRow = typeof orders.$inferSelect;

export type TransitionResult =
  | { ok: true; order: OrderRow; nextRecurringOrderId: number | null }
  | { ok: false; status: number; error: string };

/**
 * The order status state machine — the single source of truth shared by every
 * delivery/transition surface (web PATCH, Telegram inline buttons). Callers
 * authenticate + authorize, fetch the order, then hand it here; each renders the
 * result its own way (JSON vs Telegram messages).
 *
 * Responsibilities: validate the transition, flip the status atomically
 * (compare-and-swap — the serialization point, since neon-http has no
 * interactive transactions), then run the delivery/ready/cancel side effects.
 * All side effects are best-effort: the status flip is already committed, so a
 * charge / clone / notification failure is logged, never thrown.
 *
 * @param order  the current (pre-transition) order row, already authorized
 * @param newStatus  the target status
 * @param opts.notifyCustomer  send the customer WhatsApp on ready/cancel (default true)
 */
export async function transitionOrderStatus(
  order: OrderRow,
  newStatus: string,
  opts: { notifyCustomer?: boolean } = {}
): Promise<TransitionResult> {
  const shouldNotify = opts.notifyCustomer !== false;

  const allowed = ORDER_STATUS_TRANSITIONS[order.status];
  if (!allowed?.includes(newStatus)) {
    return { ok: false, status: 400, error: `Cannot transition from ${order.status} to ${newStatus}` };
  }

  // Atomic compare-and-swap: only the request that actually flips the status
  // away from the value we read runs the side effects. A concurrent double-fire
  // (double tap / retry) finds status already changed and loses the race.
  const [updated] = await db
    .update(orders)
    .set({ status: newStatus as OrderRow['status'], updatedAt: new Date() })
    .where(and(eq(orders.id, order.id), eq(orders.status, order.status)))
    .returning();

  if (!updated) {
    return { ok: false, status: 409, error: 'Order was already updated, please refresh' };
  }

  let nextRecurringOrderId: number | null = null;

  if (newStatus === 'delivered') {
    // Idempotent + best-effort: 'delivered' is terminal and already committed,
    // so a transient charge failure must be logged, not thrown, or it would
    // block the recurring clone and 500 a completed delivery.
    try {
      await ensureOrderCharge(order.id, order.groupId, order.customerId);
    } catch (err) {
      console.error(`Failed to ensure charge after delivering order ${order.id}:`, err);
    }
    if (order.isRecurring) {
      nextRecurringOrderId = await createNextRecurringOrder(order);
    }
  }

  if (newStatus === 'ready') {
    try {
      const [customer] = await db
        .select({ name: customers.name })
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
        .where(eq(orderItems.orderId, order.id));

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
        await notifyOrderReady(order.groupId, order.id, {
          customerName: customer.name,
          itemsSummary: summary,
        });
        if (shouldNotify) {
          const phones = await getCustomerPhones(order.customerId);
          await notifyCustomerWhatsApp(phones);
        }
      }
    } catch (err) {
      console.error(`Failed to send ready notifications for order ${order.id}:`, err);
    }
  }

  if (newStatus === 'cancelled' && shouldNotify) {
    try {
      const phones = await getCustomerPhones(order.customerId);
      await notifyCustomerWhatsApp(phones, 'order_cancelled');
    } catch (err) {
      console.error(`Failed to notify customer of cancellation for order ${order.id}:`, err);
    }
  }

  return { ok: true, order: updated, nextRecurringOrderId };
}
