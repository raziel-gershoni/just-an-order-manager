import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
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
import { t, type Lang } from '@/lib/i18n';
import { escapeHtml } from '@/lib/telegram-html';
import { formatStaffItemLabel } from '@/lib/order-display';
import { buildRecipeBlockForOrders } from '@/lib/order-recipe';
import { formatWeekdayShort } from '@/lib/date-utils';
import { getOrderDisplay, openUndated, todayCondition, undatedFirst } from '@/lib/asap';

/**
 * The Telegram texts that list a day's orders: /today, /week and the morning
 * baking message. The bot route and the morning cron are thin callers, so the
 * בהקדם placement switch (src/lib/asap.ts) is applied here once.
 */

export interface BakeLine {
  customerName: string;
  breadTypeName: string;
  quantity: number;
}

type ItemsMap = Record<number, { breadTypeName: string; quantity: number }[]>;

/** Each order's lines as staff read them (type, size, additions), by order id. */
async function getOrderItemsSummaries(orderIds: number[]): Promise<ItemsMap> {
  if (orderIds.length === 0) return {};
  const allItems = await db
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
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.id));

  const itemIds = allItems.map((i) => i.id);
  const additionLinks = itemIds.length
    ? await db
        .select({ orderItemId: orderItemAdditions.orderItemId, name: breadAdditions.name })
        .from(orderItemAdditions)
        .innerJoin(breadAdditions, eq(orderItemAdditions.breadAdditionId, breadAdditions.id))
        .where(inArray(orderItemAdditions.orderItemId, itemIds))
        .orderBy(asc(breadAdditions.sortOrder))
    : [];
  const additionsByItem: Record<number, string[]> = {};
  for (const a of additionLinks) {
    if (!additionsByItem[a.orderItemId]) additionsByItem[a.orderItemId] = [];
    additionsByItem[a.orderItemId].push(a.name);
  }

  const map: ItemsMap = {};
  for (const item of allItems) {
    if (!map[item.orderId]) map[item.orderId] = [];
    map[item.orderId].push({
      breadTypeName: formatStaffItemLabel(item.typeName, item.sizeName, item.weightGrams, additionsByItem[item.id] ?? []),
      quantity: item.quantity,
    });
  }
  return map;
}

interface DigestOrder {
  id: number;
  status: string;
  deliveryDate: string | null;
  customerName: string;
  notes?: string | null;
}

const loafCount = (rows: DigestOrder[], itemsMap: ItemsMap) =>
  rows.reduce((s, o) => s + (itemsMap[o.id] ?? []).reduce((ss, i) => ss + i.quantity, 0), 0);

/** The undated open orders of a bakery, oldest first. */
function loadOpenUndated(groupId: number): Promise<DigestOrder[]> {
  return db
    .select({
      id: orders.id,
      status: orders.status,
      deliveryDate: orders.deliveryDate,
      customerName: customers.name,
      notes: orders.notes,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(and(eq(orders.groupId, groupId), openUndated()))
    .orderBy(asc(orders.id));
}

/** The /today reply (HTML), or null when there is nothing today and nothing בהקדם. */
export async function todayDigestText(groupId: number, today: string, lang: Lang): Promise<string | null> {
  const { asapInToday } = await getOrderDisplay(groupId);

  const todayOrders: DigestOrder[] = await db
    .select({
      id: orders.id,
      status: orders.status,
      deliveryDate: orders.deliveryDate,
      customerName: customers.name,
      notes: orders.notes,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(and(eq(orders.groupId, groupId), todayCondition(today, asapInToday), ne(orders.status, 'cancelled')))
    // Undated rows first, oldest first; dated rows keep the customer-name order.
    .orderBy(undatedFirst, sql`(case when ${orders.deliveryDate} is null then ${orders.id} end) asc`, asc(customers.name));

  // With the switch on they are already in today's rows.
  const asapOrders = asapInToday ? [] : await loadOpenUndated(groupId);

  if (todayOrders.length === 0 && asapOrders.length === 0) return null;

  const itemsMap = await getOrderItemsSummaries([...asapOrders, ...todayOrders].map((o) => o.id));

  const orderLine = (o: DigestOrder) => {
    const items = itemsMap[o.id] || [];
    // parse_mode is HTML: a name, a bread or a note carrying & or < would
    // make Telegram reject the whole digest, and the catch only warns.
    const summary = items.map((i) => `${i.quantity} ${escapeHtml(i.breadTypeName)}`).join(', ');
    const statusEmoji = o.status === 'ready' ? '✅' : o.status === 'baking' ? '🔥' : '⏳';
    const tag = asapInToday && o.deliveryDate === null ? ` · ${t('delivery.asap', lang)}` : '';
    const out = [`${statusEmoji} ${escapeHtml(o.customerName)} — ${summary}${tag}`];
    if (o.notes) out.push(`   💬 ${escapeHtml(o.notes)}`);
    return out;
  };

  const lines = [`<b>📋 ${t('notify.morning_summary', lang)}</b>`, ''];

  if (asapOrders.length > 0) {
    lines.push(`<b>${t('delivery.asap', lang)}</b>`);
    for (const o of asapOrders) lines.push(...orderLine(o));
    lines.push('');
    lines.push(`<b>${t('notify.total_asap', lang)}:</b> ${loafCount(asapOrders, itemsMap)} ${t('notify.loaves', lang)}`);
    lines.push('');
    lines.push(`<b>${t('dash.today', lang)}</b>`);
  }

  if (todayOrders.length === 0) {
    lines.push(t('notify.no_orders_today', lang));
  } else {
    for (const o of todayOrders) lines.push(...orderLine(o));
    lines.push('');
    lines.push(`<b>${t('notify.total_today', lang)}:</b> ${loafCount(todayOrders, itemsMap)} ${t('notify.loaves', lang)}`);

    const recipeBlock = await buildRecipeBlockForOrders(todayOrders.map((o) => o.id));
    if (recipeBlock) lines.push('', recipeBlock);
  }

  return lines.join('\n');
}

/** The /week reply (HTML), or null when there is nothing. */
export async function weekDigestText(
  groupId: number,
  today: string,
  weekEnd: string,
  lang: Lang
): Promise<string | null> {
  const { asapInToday } = await getOrderDisplay(groupId);

  const weekOrders: DigestOrder[] = await db
    .select({
      id: orders.id,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      customerName: customers.name,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(orders.groupId, groupId),
        gte(orders.deliveryDate, today),
        lte(orders.deliveryDate, weekEnd),
        ne(orders.status, 'cancelled')
      )
    )
    .orderBy(asc(orders.deliveryDate), asc(customers.name));
  const asapOrders = await loadOpenUndated(groupId);

  if (weekOrders.length === 0 && asapOrders.length === 0) return null;

  // Buckets in reading order. Off: בהקדם is a bucket of its own, first.
  // On: those orders lead today's bucket, which then exists even when
  // nothing is dated today.
  const buckets: { heading: string; rows: DigestOrder[] }[] = [];
  const todayHeading = `${t('dash.today', lang)} · ${formatWeekdayShort(today)}`;
  if (asapOrders.length > 0 && !asapInToday) {
    buckets.push({ heading: t('delivery.asap', lang), rows: asapOrders });
  }
  if (asapInToday && asapOrders.length > 0) {
    buckets.push({ heading: todayHeading, rows: [...asapOrders] });
  }
  for (const o of weekOrders) {
    const heading = o.deliveryDate === today ? todayHeading : formatWeekdayShort(o.deliveryDate!);
    const last = buckets[buckets.length - 1];
    if (last && last.heading === heading) last.rows.push(o);
    else buckets.push({ heading, rows: [o] });
  }

  const itemsMap = await getOrderItemsSummaries([...asapOrders, ...weekOrders].map((o) => o.id));

  const out = [`<b>📅 ${t('notify.weekly_summary', lang)}</b>`, ''];
  for (const b of buckets) {
    out.push(`<b>${b.heading}</b> (${loafCount(b.rows, itemsMap)} ${t('notify.loaves', lang)})`);
    for (const o of b.rows) {
      const items = itemsMap[o.id] || [];
      const summary = items.map((i) => `${i.quantity} ${escapeHtml(i.breadTypeName)}`).join(', ');
      const tag = asapInToday && o.deliveryDate === null ? ` · ${t('delivery.asap', lang)}` : '';
      out.push(`  • ${escapeHtml(o.customerName)} — ${summary}${tag}`);
    }
    out.push('');
  }

  // Mixing weights cover dated orders; the undated ones count only when they are part of today.
  const recipeIds = [...(asapInToday ? asapOrders : []), ...weekOrders].map((o) => o.id);
  const recipeBlock = await buildRecipeBlockForOrders(recipeIds);
  if (recipeBlock) out.push(recipeBlock);

  return out.join('\n');
}

/** Bake lines for orders, one per order item. */
async function bakeLines(rows: { id: number; customerName: string }[]): Promise<BakeLine[]> {
  const itemsMap = await getOrderItemsSummaries(rows.map((o) => o.id));
  const lines: BakeLine[] = [];
  for (const o of rows) {
    for (const item of itemsMap[o.id] ?? []) {
      lines.push({ customerName: o.customerName, breadTypeName: item.breadTypeName, quantity: item.quantity });
    }
  }
  return lines;
}

/**
 * The morning bake: today's lines (with the בהקדם ones when the switch is on),
 * the separate בהקדם lines (off), and today's recipe block. Null when both are
 * empty.
 */
export async function morningBake(
  groupId: number,
  today: string
): Promise<{ today: BakeLine[]; asap: BakeLine[]; recipeBlock?: string } | null> {
  const { asapInToday } = await getOrderDisplay(groupId);

  const todayOrders = await db
    .select({ id: orders.id, customerName: customers.name })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(orders.groupId, groupId),
        todayCondition(today, asapInToday),
        ne(orders.status, 'cancelled'),
        ne(orders.status, 'delivered')
      )
    )
    .orderBy(undatedFirst, asc(orders.id));
  const asapOrders = asapInToday ? [] : await loadOpenUndated(groupId);

  const todayLines = await bakeLines(todayOrders);
  const asapLines = await bakeLines(asapOrders);
  if (todayLines.length === 0 && asapLines.length === 0) return null;

  // Build per-type recipe block for the baker (Hebrew); today's orders only.
  let recipeBlock: string | undefined;
  try {
    recipeBlock = (await buildRecipeBlockForOrders(todayOrders.map((o) => o.id))) || undefined;
  } catch (err) {
    console.error(`[day-digest] recipe block failed for group ${groupId}:`, err);
  }

  return { today: todayLines, asap: asapLines, recipeBlock };
}
