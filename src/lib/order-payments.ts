import { db } from '@/db';
import { orders, orderItems, payments } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Calculate the total price of an order. Honors `totalOverride` if set,
 * otherwise sums quantity × pricePerUnit across all items.
 */
export async function calculateOrderTotal(orderId: number): Promise<number> {
  const [order] = await db
    .select({ totalOverride: orders.totalOverride })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return 0;
  if (order.totalOverride) return Number(order.totalOverride);

  const items = await db
    .select({
      quantity: orderItems.quantity,
      pricePerUnit: orderItems.pricePerUnit,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  return items.reduce((s, i) => s + i.quantity * Number(i.pricePerUnit || 0), 0);
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
