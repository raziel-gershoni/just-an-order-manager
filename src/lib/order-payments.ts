import { db } from '@/db';
import { orders, orderItems, payments } from '@/db/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
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
 * Idempotent. Reports whether a row was written, and what the existing row
 * holds when one was not — a retry of the same amount is a duplicate request,
 * while a different amount is money the ledger has not been told about.
 */
export async function ensureOrderPayment(
  orderId: number,
  groupId: number,
  customerId: number,
  amount: string
): Promise<{ inserted: boolean; existingAmount?: string }> {
  const [existing] = await db
    .select({ id: payments.id, amount: payments.amount })
    .from(payments)
    .where(
      and(
        eq(payments.orderId, orderId),
        eq(payments.type, 'payment'),
        eq(payments.groupId, groupId)
      )
    )
    .limit(1);

  if (existing) return { inserted: false, existingAmount: existing.amount };

  await db.insert(payments).values({
    groupId,
    customerId,
    amount,
    type: 'payment',
    orderId,
  });
  return { inserted: true };
}

/**
 * Apply a post-delivery payment decision to an order — the one place the
 * charge/payment/paid-flag/notify sequence lives, shared by the web pay route
 * and the Telegram payment buttons. `mark_paid` just flips the flag; the others
 * ensure the charge (idempotent), record the payment when the customer paid,
 * set paid (false only for 'unpaid'), and notify. Callers own authorization and
 * the "must be delivered" precondition.
 *
 * Returns the new balance, the paid flag, and — the part that used to be
 * swallowed — whether this order already had a payment row, so nothing was
 * written this time. One payment row per order is the model, but the money is
 * real: a customer who pays half and settles the rest later would have his
 * second payment silently dropped while the bot answered "התשלום נרשם: ₪150",
 * leaving the ledger short and the customer in debt for what he had handed
 * over. Callers must say so rather than confirm a row that was never inserted.
 */
export async function recordOrderPayment(
  order: { id: number; groupId: number; customerId: number; customerName: string },
  action: 'paid' | 'credit' | 'unpaid' | 'mark_paid',
  amount?: string
): Promise<{ balance: string; paid: boolean; alreadyRecorded: boolean }> {
  if (action === 'mark_paid') {
    await db.update(orders).set({ paid: true, updatedAt: new Date() }).where(eq(orders.id, order.id));
    const balance = await getCustomerBalance(order.customerId, order.groupId);
    return { balance, paid: true, alreadyRecorded: false };
  }

  await ensureOrderCharge(order.id, order.groupId, order.customerId);
  let inserted = false;
  let alreadyRecorded = false;
  if (action === 'paid' && amount) {
    const row = await ensureOrderPayment(order.id, order.groupId, order.customerId, amount);
    inserted = row.inserted;
    // Only a DIFFERENT amount is an alarm. A tap repeated after a dropped
    // response asks for the row that is already there, and telling the owner to
    // go and record the balance would have him credit the order twice.
    alreadyRecorded = !inserted && Number(row.existingAmount) !== Number(amount);
  }

  const paid = action !== 'unpaid';
  await db.update(orders).set({ paid, updatedAt: new Date() }).where(eq(orders.id, order.id));

  const balance = await getCustomerBalance(order.customerId, order.groupId);
  // No row written, no announcement: a stale ✅ on an old Telegram message used
  // to ping both of them a second time for one payment.
  if (action === 'paid' && amount && order.customerName && inserted) {
    await notifyPrepayment(order.groupId, {
      customerName: order.customerName,
      amount,
      balance: Number(balance),
    });
  }
  return { balance, paid, alreadyRecorded };
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

/**
 * Bring a customer's `paid` flags back in line with their ledger.
 *
 * The bakery runs a tab, so money usually arrives against the customer rather
 * than one order. Such a payment lands in the ledger and nothing else, which
 * used to leave every delivery flagged unpaid however much credit it left
 * behind — the order screen and the daily unpaid nudge would keep chasing a
 * customer who was already square.
 *
 * Allocating payments oldest-first is the same thing as letting the newest
 * deliveries absorb whatever is still owed, so walk them newest-first, let the
 * debt soak in, and settle everything the money has already covered. An order
 * the debt only partly reaches stays unpaid — it isn't paid off yet.
 *
 * Only ever settles. A fresh charge must not un-tick a delivery someone marked
 * paid by hand, and an order carrying no charge row is invisible to the balance,
 * so no payment in it can have covered that order. Returns the ids settled.
 */
export async function settleCoveredOrders(
  customerId: number,
  groupId: number
): Promise<number[]> {
  const balance = Number(await getCustomerBalance(customerId, groupId));
  let owed = balance < 0 ? -balance : 0;

  const open = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.groupId, groupId),
        eq(orders.customerId, customerId),
        eq(orders.status, 'delivered'),
        eq(orders.paid, false)
      )
    )
    // Same date fallback the unpaid nudge uses, so an ASAP order with no
    // delivery date sorts by when it was written instead of last.
    .orderBy(
      sql`coalesce(${orders.deliveryDate}, ${orders.createdAt}::date) desc`,
      desc(orders.id)
    );
  if (open.length === 0) return [];

  const chargeRows = await db
    .select({ orderId: payments.orderId })
    .from(payments)
    .where(
      and(
        eq(payments.groupId, groupId),
        eq(payments.customerId, customerId),
        eq(payments.type, 'charge')
      )
    );
  const charged = new Set(
    chargeRows.map((r) => r.orderId).filter((id): id is number => id != null)
  );

  const settled: number[] = [];
  for (const o of open) {
    if (!charged.has(o.id)) continue;
    if (owed <= 0) {
      settled.push(o.id);
      continue;
    }
    owed -= await calculateOrderTotal(o.id);
  }

  if (settled.length > 0) {
    await db
      .update(orders)
      .set({ paid: true, updatedAt: new Date() })
      .where(inArray(orders.id, settled));
  }
  return settled;
}
