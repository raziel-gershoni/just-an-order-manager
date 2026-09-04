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
 * What happened to the order's payment row, so a caller never confirms money it
 * did not move. One row per order is the model; the money is real.
 *
 *  - `written`   a payment row was inserted.
 *  - `duplicate` a row for the same amount was already there — a repeated tap
 *                after a dropped response, not missing money. Report success.
 *  - `already`   a row exists for a DIFFERENT amount, so this money was NOT
 *                recorded: half paid on Tuesday, the rest on Wednesday, and the
 *                second half silently dropped while the bot answered
 *                "התשלום נרשם: ₪150". The owner has to be told.
 *  - `undone`    the row that ✅ wrote was removed — the undo of a mistaken tap.
 *  - `kept`      the order was called unpaid, but its payment row is for some
 *                other amount, so it was left alone rather than erased.
 *  - `covered`   the order was called unpaid, but the tab already covers it —
 *                credit settled it, and re-opening it would chase a customer
 *                who is square. Nothing changed.
 *  - `none`      there was nothing to write or take back.
 */
export type PaymentOutcome =
  | 'written'
  | 'duplicate'
  | 'already'
  | 'undone'
  | 'kept'
  | 'covered'
  | 'none';

/**
 * Apply a post-delivery payment decision to an order — the one place the
 * charge/payment/paid-flag/notify sequence lives, shared by the web pay route
 * and the Telegram payment buttons. `mark_paid` just flips the flag; the others
 * ensure the charge (idempotent), record the payment when the customer paid,
 * set paid (false only for 'unpaid'), and notify. Callers own authorization and
 * the "must be delivered" precondition.
 *
 * `unpaid` is also the undo of a mistaken ✅: in Telegram both buttons sit in one
 * row, so ✅ leaves 📝 standing forever, and it used to answer "סומן לתשלום"
 * without writing anything — the bogus payment stood and the customer kept a
 * credit he never earned. The undo only takes back a row for the FULL order
 * total, which is the only row ✅ can have written. A partial payment recorded
 * by hand is somebody's actual money: it is kept, and the caller says so.
 */
export async function recordOrderPayment(
  order: { id: number; groupId: number; customerId: number; customerName: string },
  action: 'paid' | 'credit' | 'unpaid' | 'mark_paid',
  amount?: string
): Promise<{ balance: string; paid: boolean; outcome: PaymentOutcome }> {
  if (action === 'mark_paid') {
    await db.update(orders).set({ paid: true, updatedAt: new Date() }).where(eq(orders.id, order.id));
    const balance = await getCustomerBalance(order.customerId, order.groupId);
    return { balance, paid: true, outcome: 'none' };
  }

  await ensureOrderCharge(order.id, order.groupId, order.customerId);

  let outcome: PaymentOutcome = 'none';

  if (action === 'paid' && amount) {
    const row = await ensureOrderPayment(order.id, order.groupId, order.customerId, amount);
    outcome = row.inserted
      ? 'written'
      : Number(row.existingAmount) === Number(amount)
        ? 'duplicate'
        : 'already';
  }

  if (action === 'unpaid') {
    const [existing] = await db
      .select({ id: payments.id, amount: payments.amount })
      .from(payments)
      .where(
        and(
          eq(payments.orderId, order.id),
          eq(payments.type, 'payment'),
          eq(payments.groupId, order.groupId)
        )
      )
      .limit(1);
    if (existing) {
      const total = await calculateOrderTotal(order.id);
      if (Number(existing.amount) === total) {
        await db.delete(payments).where(eq(payments.id, existing.id));
        outcome = 'undone';
      } else {
        // Not ours to erase. A ₪150 against a ₪300 order is money somebody
        // counted; deleting it would move the balance by an amount nothing
        // records, and re-tapping ✅ would then re-file the full ₪300.
        outcome = 'kept';
      }
    } else {
      // Nothing to take back. If the order is settled AND the tab covers it,
      // it was settled by credit and re-opening it would chase a customer who
      // is square — the 📝 button in Telegram outlives its order, so that tap
      // arrives long after the decision. But refusing on the flag alone would
      // make `paid` a one-way door: this is the only write in the codebase that
      // clears it, so an order settled from credit that later stops being
      // covered — a bounced transfer, a corrective charge — could never be
      // chased again. The ledger decides, and the caller is told which happened.
      const [row] = await db
        .select({ paid: orders.paid })
        .from(orders)
        .where(eq(orders.id, order.id))
        .limit(1);
      if (row?.paid) {
        const settledBalance = await getCustomerBalance(order.customerId, order.groupId);
        if (Number(settledBalance) >= 0) {
          return { balance: settledBalance, paid: true, outcome: 'covered' };
        }
      }
    }
  }

  const paid = action !== 'unpaid';
  await db.update(orders).set({ paid, updatedAt: new Date() }).where(eq(orders.id, order.id));

  const balance = await getCustomerBalance(order.customerId, order.groupId);
  // No row written, no announcement: a stale ✅ on an old Telegram message used
  // to ping both of them a second time for one payment.
  if (outcome === 'written' && order.customerName && amount) {
    await notifyPrepayment(order.groupId, {
      customerName: order.customerName,
      amount,
      balance: Number(balance),
    });
  }
  return { balance, paid, outcome };
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
