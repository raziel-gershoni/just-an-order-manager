import { db } from '@/db';
import { orders, orderItems, payments } from '@/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { orderTotalFromGoods } from './order-pricing';

/**
 * What an order costs and what has been paid against it: reads only. Kept apart
 * from order-payments.ts, which writes and notifies, so the bot's order messages
 * (src/lib/order-buttons.ts) can read them without importing their own callers.
 */

/** Shekels as whole agorot, so ₪0.1 + ₪0.2 compares equal to ₪0.3. */
export const cents = (v: string | number): number => Math.round(Number(v) * 100);

/**
 * Calculate the total price of an order via the one read-total rule
 * (totalOverride ?? goods) + fee, where goods prefers the frozen bulk-priced
 * snapshot and falls back to Σ qty×price for legacy orders.
 */
export async function calculateOrderTotal(orderId: number): Promise<number> {
  const [order] = await db
    .select({
      totalOverride: orders.totalOverride,
      deliveryFee: orders.deliveryFee,
      goodsSnapshot: orders.goodsSnapshot,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return 0;

  // Goods is only consulted when there's no override; the legacy items query
  // runs only when there's neither an override nor a snapshot.
  let goods = 0;
  if (order.totalOverride == null) {
    if (order.goodsSnapshot != null) {
      goods = Number(order.goodsSnapshot);
    } else {
      const items = await db
        .select({ quantity: orderItems.quantity, pricePerUnit: orderItems.pricePerUnit })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));
      goods = items.reduce((s, i) => s + i.quantity * Number(i.pricePerUnit || 0), 0);
    }
  }
  return orderTotalFromGoods(order, goods);
}

/**
 * Money already filed against each order (its `payment` rows), in shekels.
 * Orders with none are absent from the map.
 */
export async function orderPaymentsTotals(
  groupId: number,
  orderIds: number[]
): Promise<Map<number, number>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({
      orderId: payments.orderId,
      paid: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.groupId, groupId),
        eq(payments.type, 'payment'),
        inArray(payments.orderId, orderIds)
      )
    )
    .groupBy(payments.orderId);
  return new Map(
    rows.filter((r) => r.orderId != null).map((r) => [r.orderId as number, Number(r.paid)])
  );
}

/** An order's total, what has been paid against it, and what is still due (≥ 0). */
export async function orderPaymentState(
  orderId: number,
  groupId: number
): Promise<{ total: number; paidAmount: number; due: number }> {
  const [total, paidByOrder] = await Promise.all([
    calculateOrderTotal(orderId),
    orderPaymentsTotals(groupId, [orderId]),
  ]);
  const paidAmount = paidByOrder.get(orderId) ?? 0;
  return {
    total,
    paidAmount,
    due: Math.max(0, cents(total) - cents(paidAmount)) / 100,
  };
}
