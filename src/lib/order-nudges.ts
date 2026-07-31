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
import { and, asc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { format, subDays } from 'date-fns';
import { todayStr } from './date-utils';
import { formatStaffItemLabel } from './order-display';
import { calculateOrderTotal } from './order-payments';
import { notifyPendingApproval, notifyUnpaidOrders } from './notifications';

/**
 * The daily "something is still waiting on you" nudges. Both look for orders
 * that stalled in a state only a person can clear — never approved, never
 * settled — and put the action itself in the chat as an inline button, so
 * clearing the backlog costs one tap rather than a trip into the app.
 *
 * Data gathering lives here; the Telegram wording lives in `notifications`.
 * Callers (the morning cron) own scheduling and per-group error handling.
 */

// Each order in a nudge carries its own button, so the list is capped well
// under Telegram's keyboard and message-length limits. The overflow is counted
// and reported in the message, never dropped in silence.
const MAX_NUDGE_ORDERS = 10;

// A delivery gets a week to settle before it's chased — the bakery runs tabs,
// so yesterday's unpaid order is normal, and a fortnight's is not.
const UNPAID_GRACE_DAYS = 7;

export interface NudgeResult {
  /** Orders that qualified. */
  total: number;
  /** Orders that fit in the message (the rest are summarised as "ועוד N"). */
  shown: number;
  sent: number;
  failed: number;
}

/**
 * Orders still sitting at `pending` with their delivery ahead of them — nobody
 * ever tapped אשר. Returns null when there's nothing to chase (no message).
 */
export async function sendPendingApprovalNudge(groupId: number): Promise<NudgeResult | null> {
  const today = todayStr();
  const rows = await db
    .select({
      id: orders.id,
      customerName: customers.name,
      deliveryDate: orders.deliveryDate,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(orders.groupId, groupId),
        eq(orders.status, 'pending'),
        // ASAP orders carry no delivery date, and "as soon as possible" is
        // always still ahead of us — those are the ones most worth chasing,
        // so a plain `deliveryDate >= today` (which drops NULLs) won't do.
        or(isNull(orders.deliveryDate), gte(orders.deliveryDate, today))
      )
    )
    // Postgres sorts NULLs last on ASC, which would bury the ASAP orders at the
    // bottom of a list sorted by urgency. They belong at the top.
    .orderBy(sql`${orders.deliveryDate} asc nulls first`, asc(orders.id));

  if (rows.length === 0) return null;

  const shown = rows.slice(0, MAX_NUDGE_ORDERS);
  const itemsByOrder = await loadStaffItems(shown.map((o) => o.id));

  const { sent, failed } = await notifyPendingApproval(
    groupId,
    shown.map((o) => ({ ...o, items: itemsByOrder[o.id] ?? [] })),
    rows.length - shown.length
  );
  return { total: rows.length, shown: shown.length, sent, failed };
}

/**
 * Orders delivered at least a week ago that were never marked paid. Paying from
 * credit sets `paid`, so what's left here is real outstanding money.
 * Returns null when there's nothing to chase (no message).
 */
export async function sendUnpaidNudge(groupId: number): Promise<NudgeResult | null> {
  const cutoff = format(subDays(new Date(), UNPAID_GRACE_DAYS), 'yyyy-MM-dd');
  const rows = await db
    .select({
      id: orders.id,
      customerName: customers.name,
      deliveryDate: orders.deliveryDate,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(orders.groupId, groupId),
        eq(orders.status, 'delivered'),
        eq(orders.paid, false),
        // ASAP orders have no delivery date; fall back to when the order was
        // written so one still ages into the list instead of never qualifying.
        sql`coalesce(${orders.deliveryDate}, ${orders.createdAt}::date) <= ${cutoff}`
      )
    )
    // Oldest debt first. Sorting on the raw column would push every ASAP order
    // to the end however long it had been outstanding, so sort on the same
    // fallback the filter and the message use.
    .orderBy(sql`coalesce(${orders.deliveryDate}, ${orders.createdAt}::date) asc`, asc(orders.id));

  if (rows.length === 0) return null;

  // Amounts come from the one read-total rule rather than a re-derived sum, so
  // a nudge can never quote a figure the order screen disagrees with.
  const withTotals = (
    await Promise.all(rows.map(async (o) => ({ ...o, total: await calculateOrderTotal(o.id) })))
  ).filter((o) => o.total > 0); // a zero-total order owes nothing to chase

  if (withTotals.length === 0) return null;

  const shown = withTotals.slice(0, MAX_NUDGE_ORDERS);
  const { sent, failed } = await notifyUnpaidOrders(
    groupId,
    shown.map((o) => ({
      id: o.id,
      customerName: o.customerName,
      date: o.deliveryDate ?? format(o.createdAt, 'yyyy-MM-dd'),
      total: o.total,
    })),
    withTotals.length - shown.length
  );
  return { total: withTotals.length, shown: shown.length, sent, failed };
}

/** Baker-facing item lines (type, size, weight, additions) keyed by order id. */
async function loadStaffItems(
  orderIds: number[]
): Promise<Record<number, { breadTypeName: string; quantity: number }[]>> {
  if (orderIds.length === 0) return {};

  const rows = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      typeName: breadTypes.name,
      sizeName: breadSizes.name,
      weightGrams: breadSizes.weightGrams,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
    .where(inArray(orderItems.orderId, orderIds));

  const itemIds = rows.map((r) => r.id);
  const addRows = itemIds.length
    ? await db
        .select({ orderItemId: orderItemAdditions.orderItemId, name: breadAdditions.name })
        .from(orderItemAdditions)
        .innerJoin(breadAdditions, eq(orderItemAdditions.breadAdditionId, breadAdditions.id))
        .where(inArray(orderItemAdditions.orderItemId, itemIds))
        .orderBy(asc(breadAdditions.sortOrder))
    : [];

  const addsByItem: Record<number, string[]> = {};
  for (const a of addRows) {
    if (!addsByItem[a.orderItemId]) addsByItem[a.orderItemId] = [];
    addsByItem[a.orderItemId].push(a.name);
  }

  const byOrder: Record<number, { breadTypeName: string; quantity: number }[]> = {};
  for (const r of rows) {
    if (!byOrder[r.orderId]) byOrder[r.orderId] = [];
    byOrder[r.orderId].push({
      breadTypeName: formatStaffItemLabel(r.typeName, r.sizeName, r.weightGrams, addsByItem[r.id] ?? []),
      quantity: r.quantity,
    });
  }
  return byOrder;
}
