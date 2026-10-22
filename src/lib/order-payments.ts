import { db } from '@/db';
import { orders, orderItems, payments } from '@/db/schema';
import { eq, and, desc, inArray, notInArray, sql } from 'drizzle-orm';
import { orderTotalFromGoods } from './order-pricing';
import { notifyPrepayment } from './notifications';

/** Shekels as whole agorot, so ₪0.1 + ₪0.2 compares equal to ₪0.3. */
const cents = (v: string | number): number => Math.round(Number(v) * 100);
/** Agorot back to the decimal string the ledger stores ("120", "99.50"). */
const shekels = (c: number): string => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));

const OPEN_EXCLUDED = ['delivered', 'cancelled'] as const;

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

/**
 * The order's own payment rows, oldest first, and its charge if written.
 * A payment written before the charge was paid in advance: the charge is
 * written when the order is delivered.
 */
async function orderLedger(
  orderId: number,
  groupId: number
): Promise<{ chargeId: number | null; payments: { id: number; amount: string }[] }> {
  const rows = await db
    .select({ id: payments.id, amount: payments.amount, type: payments.type })
    .from(payments)
    .where(
      and(
        eq(payments.orderId, orderId),
        eq(payments.groupId, groupId),
        inArray(payments.type, ['payment', 'charge'])
      )
    )
    .orderBy(payments.id);
  const charge = rows.find((r) => r.type === 'charge');
  return {
    chargeId: charge?.id ?? null,
    payments: rows.filter((r) => r.type === 'payment').map(({ id, amount }) => ({ id, amount })),
  };
}

/**
 * File a payment against an order, unless it would count money twice. Shared
 * by payment at delivery and payment in advance, so both follow one rule.
 *
 * The first payment on an order is always written. After that a payment is
 * written only when it pays exactly what is still due — the rest of a price
 * that grew after the customer paid ahead, which can equal the first amount
 * (two loaves paid, two more added). Anything else is not written:
 *  - `duplicate` once the order is covered and a payment of this amount is
 *    already on it from the same stage — a repeated tap after a dropped
 *    response. The stage matters: at the door, a match against money paid in
 *    advance is the customer paying twice on a stale screen, not a retry.
 *  - `already` otherwise, so the caller says the money was not stored. While
 *    something is still due a same-amount payment can't be told from a new
 *    one (₪50, then another ₪50), and a loud refusal beats a quiet loss.
 * Once the order is paid nothing is due, so a retry never writes. The one
 * ambiguity: a retry of a first payment of exactly half the total reads as
 * the second half.
 *
 * No `amount` means "in full": whatever is still due, or nothing.
 */
async function writeOrderPayment(
  order: { id: number; groupId: number; customerId: number },
  amount: string | undefined
): Promise<{ outcome: 'written' | 'duplicate' | 'already' | 'none'; recorded?: string }> {
  const { chargeId, payments: rows } = await orderLedger(order.id, order.groupId);
  const total = cents(await calculateOrderTotal(order.id));
  const due = total - rows.reduce((s, r) => s + cents(r.amount), 0);
  // Rows a repeated tap could be repeating: once charged, only those written
  // at delivery (after the charge).
  const sameStage = chargeId == null ? rows : rows.filter((r) => r.id > chargeId);

  let pay: number;
  if (amount === undefined) {
    if (due <= 0) return { outcome: rows.length > 0 ? 'duplicate' : 'none' };
    pay = due;
  } else {
    pay = cents(amount);
    const fresh = rows.length === 0 || (due > 0 && pay === due);
    if (!fresh) {
      const retry = due <= 0 && sameStage.some((r) => cents(r.amount) === pay);
      return { outcome: retry ? 'duplicate' : 'already' };
    }
  }
  if (pay <= 0) return { outcome: 'none' };

  const recorded = shekels(pay);
  await db.insert(payments).values({
    groupId: order.groupId,
    customerId: order.customerId,
    amount: recorded,
    type: 'payment',
    orderId: order.id,
  });
  return { outcome: 'written', recorded };
}

/**
 * What happened to the order's payment row, so a caller never confirms money it
 * did not move. The money is real.
 *
 *  - `written`   a payment row was inserted.
 *  - `duplicate` that money was already on the order — a repeated tap after a
 *                dropped response, not missing money. Report success.
 *  - `already`   the order carries a payment and this one does not finish it,
 *                so this money was NOT recorded: half paid on Tuesday, the
 *                rest on Wednesday, and the second half silently dropped while
 *                the bot answered "התשלום נרשם: ₪150". The owner has to be told.
 *  - `undone`    the row that ✅ wrote was removed — the undo of a mistaken tap.
 *  - `kept`      the order was called unpaid, but its payment row is for some
 *                other amount, so it was left alone rather than erased.
 *  - `covered`   the order was called unpaid, but the tab (or its own payment
 *                in advance) already covers it, and re-opening it would chase a
 *                customer who is square. Nothing changed.
 *  - `short`     settling from credit was asked, but the customer's free credit
 *                doesn't cover the order — money paid ahead for another open
 *                order is that order's. Left unpaid.
 *  - `none`      there was nothing to write or take back.
 */
export type PaymentOutcome =
  | 'written'
  | 'duplicate'
  | 'already'
  | 'undone'
  | 'kept'
  | 'covered'
  | 'short'
  | 'none';

/**
 * Apply a post-delivery payment decision to an order — the one place the
 * charge/payment/paid-flag/notify sequence lives, shared by the web pay route
 * and the Telegram payment buttons. `mark_paid` just flips the flag; the others
 * ensure the charge (idempotent), record the payment when the customer paid,
 * set paid (false only for 'unpaid'), and notify. Callers own authorization and
 * the "must be delivered" precondition.
 *
 * `paid` without an amount is "paid in full": it records what is still due —
 * the whole total, or the rest of an order paid partly in advance.
 *
 * `unpaid` is also the undo of a mistaken ✅: in Telegram both buttons sit in one
 * row, so ✅ leaves 📝 standing forever, and it used to answer "סומן לתשלום"
 * without writing anything — the bogus payment stood and the customer kept a
 * credit he never earned. The undo only takes back a row written after the
 * charge, when the order's payments exactly cover it, which is the only row ✅
 * can have written. A partial payment recorded by hand is somebody's actual
 * money, and so is a payment in advance: they are kept, and the caller says so.
 */
export async function recordOrderPayment(
  order: { id: number; groupId: number; customerId: number; customerName: string },
  action: 'paid' | 'credit' | 'unpaid' | 'mark_paid',
  amount?: string
): Promise<{ balance: string; paid: boolean; outcome: PaymentOutcome; recorded?: string }> {
  if (action === 'mark_paid') {
    await db.update(orders).set({ paid: true, updatedAt: new Date() }).where(eq(orders.id, order.id));
    const balance = await getCustomerBalance(order.customerId, order.groupId);
    return { balance, paid: true, outcome: 'none' };
  }

  await ensureOrderCharge(order.id, order.groupId, order.customerId);

  let outcome: PaymentOutcome = 'none';
  let recorded: string | undefined;

  if (action === 'paid') {
    ({ outcome, recorded } = await writeOrderPayment(order, amount));
    if (outcome === 'already') {
      // Nothing was stored, so nothing changes: marking it paid would hide
      // what is still owed from the unpaid nudge.
      const [row] = await db.select({ paid: orders.paid }).from(orders).where(eq(orders.id, order.id)).limit(1);
      const balance = await getCustomerBalance(order.customerId, order.groupId);
      return { balance, paid: row?.paid ?? false, outcome };
    }
  }

  if (action === 'credit' && (await availableCents(order.customerId, order.groupId)) < 0) {
    // The screen offered credit the tab doesn't have free: a stale page, or
    // money paid ahead for another open order counted as loose credit.
    const [row] = await db.select({ paid: orders.paid }).from(orders).where(eq(orders.id, order.id)).limit(1);
    const balance = await getCustomerBalance(order.customerId, order.groupId);
    return { balance, paid: row?.paid ?? false, outcome: 'short' };
  }

  if (action === 'unpaid') {
    const ledger = await orderLedger(order.id, order.groupId);
    const total = cents(await calculateOrderTotal(order.id));
    const paidSoFar = ledger.payments.reduce((s, p) => s + cents(p.amount), 0);
    const chargeId = ledger.chargeId;
    const atDelivery = chargeId == null ? [] : ledger.payments.filter((p) => p.id > chargeId);
    const last = atDelivery.at(-1);
    if (last) {
      if (paidSoFar === total) {
        await db.delete(payments).where(eq(payments.id, last.id));
        outcome = 'undone';
      } else {
        // Not ours to erase. A ₪150 against a ₪300 order is money somebody
        // counted; deleting it would move the balance by an amount nothing
        // records, and re-tapping ✅ would then re-file the full ₪300.
        outcome = 'kept';
      }
    } else if (ledger.payments.length > 0 && paidSoFar >= total) {
      // Paid in advance, and that money covers it: there is nothing a ✅
      // wrote to take back, and nothing to chase.
      const balance = await getCustomerBalance(order.customerId, order.groupId);
      return { balance, paid: true, outcome: 'covered' };
    } else {
      // Nothing to take back. If the order is settled AND the tab covers it,
      // it was settled by credit and re-opening it would chase a customer who
      // is square — the 📝 button in Telegram outlives its order, so that tap
      // arrives long after the decision. But refusing on the flag alone would
      // make `paid` a one-way door: this is the only write that clears it on a
      // delivered order, so an order settled from credit that later stops being
      // covered — a bounced transfer, a corrective charge — could never be
      // chased again. The ledger decides, and the caller is told which happened.
      const [row] = await db
        .select({ paid: orders.paid })
        .from(orders)
        .where(eq(orders.id, order.id))
        .limit(1);
      if (row?.paid && (await availableCents(order.customerId, order.groupId)) >= 0) {
        const balance = await getCustomerBalance(order.customerId, order.groupId);
        return { balance, paid: true, outcome: 'covered' };
      }
    }
  }

  const paid = action !== 'unpaid';
  await db.update(orders).set({ paid, updatedAt: new Date() }).where(eq(orders.id, order.id));

  const balance = await getCustomerBalance(order.customerId, order.groupId);
  // No row written, no announcement: a stale ✅ on an old Telegram message used
  // to ping both of them a second time for one payment.
  if (outcome === 'written' && order.customerName && recorded) {
    await notifyPrepayment(order.groupId, {
      customerName: order.customerName,
      amount: recorded,
      balance: Number(balance),
    });
  }
  return { balance, paid, outcome, recorded };
}

/**
 * An open order's `paid` flag mirrors its own money: paid while the payments
 * filed against it cover its current total. Run after paying in advance and
 * after every edit, since an open order's price can still change — ₪100 paid
 * and two loaves added must read unpaid again, or the driver hands them over
 * without collecting. An order with no money of its own is left alone.
 *
 * Returns the order's figures, or null when it is no longer open.
 */
export async function syncPrepaidFlag(
  orderId: number,
  groupId: number
): Promise<{ paid: boolean; paidAmount: number; due: number } | null> {
  const [row] = await db
    .select({ paid: orders.paid, status: orders.status })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.groupId, groupId)))
    .limit(1);
  if (!row || (OPEN_EXCLUDED as readonly string[]).includes(row.status)) return null;

  const state = await orderPaymentState(orderId, groupId);
  if (state.paidAmount <= 0) return { paid: row.paid, paidAmount: 0, due: state.due };
  const paid = state.due <= 0;
  if (paid !== row.paid) {
    await db
      .update(orders)
      .set({ paid, updatedAt: new Date() })
      .where(
        and(eq(orders.id, orderId), eq(orders.groupId, groupId), notInArray(orders.status, [...OPEN_EXCLUDED]))
      );
  }
  return { paid, paidAmount: state.paidAmount, due: state.due };
}

/**
 * Record money a customer paid for an order before it was delivered. It is an
 * ordinary payment filed against the order and nothing more: the charge is
 * still written at delivery, at the price of that day, so the income report
 * counts the order in the month it went out and a cancelled order owes
 * nothing. Same one-payment rule as at delivery (`writeOrderPayment`). The
 * caller checks the order is open.
 */
export async function recordPrepayment(
  order: { id: number; groupId: number; customerId: number; customerName: string },
  amount: string
): Promise<{ outcome: 'written' | 'duplicate' | 'already' | 'none'; paid: boolean; paidAmount: number; due: number }> {
  const { outcome, recorded } = await writeOrderPayment(order, amount);
  const state = await syncPrepaidFlag(order.id, order.groupId);
  if (!state) {
    // Delivered or cancelled while this was being written: the money is a
    // plain payment now, and the tab settles whatever it covers.
    console.error(`Order ${order.id} closed while a payment in advance was recorded; settling the tab`);
    await settleCoveredOrders(order.customerId, order.groupId);
    const after = await orderPaymentState(order.id, order.groupId);
    return { outcome, paid: after.due <= 0, paidAmount: after.paidAmount, due: after.due };
  }
  if (outcome === 'written' && recorded) {
    try {
      await notifyPrepayment(order.groupId, {
        customerName: order.customerName,
        amount: recorded,
        balance: Number(await getCustomerBalance(order.customerId, order.groupId)),
        order: { id: order.id, due: state.due },
      });
    } catch (err) {
      console.error(`Failed to announce the payment in advance on order ${order.id}:`, err);
    }
  }
  return { outcome, ...state };
}

/**
 * Take back a payment in advance recorded by mistake: every payment filed
 * against the order, only while it is still open, so it can never pull money
 * out from under a delivery. The flag drops first: a delivery landing in
 * between then finds the money still there and settles the order itself, and
 * the delete, guarded on the order being open, takes nothing. The other way
 * round, a delivered order could keep reading paid with its money gone.
 * Returns what was removed, or null when the order is no longer open.
 */
export async function cancelPrepayment(order: {
  id: number;
  groupId: number;
}): Promise<{ removed: number } | null> {
  const [open] = await db
    .update(orders)
    .set({ paid: false, updatedAt: new Date() })
    .where(
      and(eq(orders.id, order.id), eq(orders.groupId, order.groupId), notInArray(orders.status, [...OPEN_EXCLUDED]))
    )
    .returning({ id: orders.id });
  if (!open) return null;
  const removedRows = await db
    .delete(payments)
    .where(
      and(
        eq(payments.orderId, order.id),
        eq(payments.groupId, order.groupId),
        eq(payments.type, 'payment'),
        sql`exists (select 1 from ${orders} where ${orders.id} = ${order.id} and ${orders.status} not in ('delivered', 'cancelled'))`
      )
    )
    .returning({ amount: payments.amount });
  if (removedRows.length === 0) {
    // Nothing removed: there was nothing, or the order closed in between.
    const [now] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)).limit(1);
    if (!now || (OPEN_EXCLUDED as readonly string[]).includes(now.status)) return null;
  }
  return { removed: removedRows.reduce((s, r) => s + cents(r.amount), 0) / 100 };
}

/**
 * A cancelled order's payment in advance stays with the customer as credit:
 * the order stops reading paid, and the tab settles any delivered order the
 * freed money now covers. Nothing to do for an order nobody paid ahead.
 */
export async function releasePrepayment(order: {
  id: number;
  groupId: number;
  customerId: number;
}): Promise<void> {
  const paidByOrder = await orderPaymentsTotals(order.groupId, [order.id]);
  if (!(paidByOrder.get(order.id) ?? 0)) return;
  await db
    .update(orders)
    .set({ paid: false, updatedAt: new Date() })
    .where(and(eq(orders.id, order.id), eq(orders.status, 'cancelled')));
  await settleCoveredOrders(order.customerId, order.groupId);
}

/**
 * Skipping a paid week moves its payment in advance to the next order, which
 * then reads paid there — left on the tab, next week would read unpaid and the
 * driver would collect it a second time. Returns the amount moved.
 */
export async function movePrepayment(
  from: { id: number; groupId: number },
  toOrderId: number
): Promise<number> {
  const moved = await db
    .update(payments)
    .set({ orderId: toOrderId })
    .where(
      and(eq(payments.orderId, from.id), eq(payments.groupId, from.groupId), eq(payments.type, 'payment'))
    )
    .returning({ amount: payments.amount });
  if (moved.length === 0) return 0;
  await db.update(orders).set({ paid: false, updatedAt: new Date() }).where(eq(orders.id, from.id));
  await syncPrepaidFlag(toOrderId, from.groupId);
  return moved.reduce((s, r) => s + cents(r.amount), 0) / 100;
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
 * The customer's balance free to spend on an order, as a ledger string: the
 * running balance less money paid ahead for orders not yet delivered. The pay
 * card offers "קזז מקרדיט" on this, never on the raw balance.
 */
export async function getAvailableBalance(customerId: number, groupId: number): Promise<string> {
  return (await availableCents(customerId, groupId) / 100).toFixed(2);
}

/**
 * The balance free to settle delivered orders, in agorot: the ledger minus
 * what sits on orders not yet delivered. Money paid ahead for Friday's order
 * is Friday's; counted as loose credit it would mark last week's unpaid
 * delivery paid, and both would read "שולם" while that week is still owed.
 */
async function availableCents(customerId: number, groupId: number): Promise<number> {
  const [[ledger], [held]] = await Promise.all([
    db
      .select({ balance: sql<string>`COALESCE(SUM(${payments.amount}), 0)` })
      .from(payments)
      .where(and(eq(payments.customerId, customerId), eq(payments.groupId, groupId))),
    db
      .select({ held: sql<string>`COALESCE(SUM(${payments.amount}), 0)` })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .where(
        and(
          eq(payments.customerId, customerId),
          eq(payments.groupId, groupId),
          notInArray(orders.status, [...OPEN_EXCLUDED])
        )
      ),
  ]);
  return cents(ledger.balance) - cents(held.held);
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
 * the debt only partly reaches stays unpaid — it isn't paid off yet. An order
 * absorbs only what its own payments leave due, and money held by orders not
 * yet delivered is not the tab's to spend (`availableCents`).
 *
 * Only ever settles. A fresh charge must not un-tick a delivery someone marked
 * paid by hand, and an order carrying no charge row is invisible to the balance,
 * so no payment in it can have covered that order. Returns the ids settled.
 */
export async function settleCoveredOrders(
  customerId: number,
  groupId: number
): Promise<number[]> {
  const available = await availableCents(customerId, groupId);
  let owed = available < 0 ? -available : 0;

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

  const [chargeRows, paidByOrder] = await Promise.all([
    db
      .select({ orderId: payments.orderId })
      .from(payments)
      .where(
        and(
          eq(payments.groupId, groupId),
          eq(payments.customerId, customerId),
          eq(payments.type, 'charge')
        )
      ),
    orderPaymentsTotals(groupId, open.map((o) => o.id)),
  ]);
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
    const due = cents(await calculateOrderTotal(o.id)) - cents(paidByOrder.get(o.id) ?? 0);
    // Its own payments cover it, whatever else the customer owes.
    if (due <= 0) {
      settled.push(o.id);
      continue;
    }
    owed -= due;
  }

  if (settled.length > 0) {
    await db
      .update(orders)
      .set({ paid: true, updatedAt: new Date() })
      .where(inArray(orders.id, settled));
  }
  return settled;
}
