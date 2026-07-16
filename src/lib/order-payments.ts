import { db } from '@/db';
import { orders, orderItems, payments } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { orderTotalFromGoods } from './order-pricing';
import { notifyPrepayment } from './notifications';

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
 * Insert a `charge` payment row for the order if one doesn't already exist.
 * Idempotent: safe to call repeatedly. Returns the order total (0 if nothing
 * to charge or order not found).
 */
export async function ensureOrderCharge(
  orderId: number,
  groupId: number,
  customerId: number
): Promise<number> {
  const total = await calculateOrderTotal(orderId);
  if (total <= 0) return 0;

  const [existing] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.orderId, orderId),
        eq(payments.type, 'charge'),
        eq(payments.groupId, groupId)
      )
    )
    .limit(1);

  if (existing) return total;

  await db.insert(payments).values({
    groupId,
    customerId,
    amount: `-${total.toFixed(2)}`,
    type: 'charge',
    orderId,
  });

  return total;
}

/**
 * Insert a `payment` row for the order if one doesn't already exist.
 * Idempotent. Returns true if a new row was inserted.
 */
export async function ensureOrderPayment(
  orderId: number,
  groupId: number,
  customerId: number,
  amount: string
): Promise<boolean> {
  const [existing] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.orderId, orderId),
        eq(payments.type, 'payment'),
        eq(payments.groupId, groupId)
      )
    )
    .limit(1);

  if (existing) return false;

  await db.insert(payments).values({
    groupId,
    customerId,
    amount,
    type: 'payment',
    orderId,
  });
  return true;
}

/**
 * Apply a post-delivery payment decision to an order — the one place the
 * charge/payment/paid-flag/notify sequence lives, shared by the web pay route
 * and the Telegram payment buttons. `mark_paid` just flips the flag; the others
 * ensure the charge (idempotent), record the payment when the customer paid,
 * set paid (false only for 'unpaid'), and notify. Returns the new balance +
 * paid flag. Callers own authorization and the "must be delivered" precondition.
 */
export async function recordOrderPayment(
  order: { id: number; groupId: number; customerId: number; customerName: string },
  action: 'paid' | 'credit' | 'unpaid' | 'mark_paid',
  amount?: string
): Promise<{ balance: string; paid: boolean }> {
  if (action === 'mark_paid') {
    await db.update(orders).set({ paid: true, updatedAt: new Date() }).where(eq(orders.id, order.id));
    const balance = await getCustomerBalance(order.customerId, order.groupId);
    return { balance, paid: true };
  }

  await ensureOrderCharge(order.id, order.groupId, order.customerId);
  if (action === 'paid' && amount) {
    await ensureOrderPayment(order.id, order.groupId, order.customerId, amount);
  }

  const paid = action !== 'unpaid';
  await db.update(orders).set({ paid, updatedAt: new Date() }).where(eq(orders.id, order.id));

  const balance = await getCustomerBalance(order.customerId, order.groupId);
  if (action === 'paid' && amount && order.customerName) {
    await notifyPrepayment(order.groupId, {
      customerName: order.customerName,
      amount,
      balance: Number(balance),
    });
  }
  return { balance, paid };
}

/**
 * Get the customer's running balance (sum of all payments rows).
 * Negative = customer owes money, positive = credit.
 */
export async function getCustomerBalance(
  customerId: number,
  groupId: number
): Promise<string> {
  const [result] = await db
    .select({
      balance: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
    })
    .from(payments)
    .where(
      and(eq(payments.customerId, customerId), eq(payments.groupId, groupId))
    );
  return result.balance;
}
