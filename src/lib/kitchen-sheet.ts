import { unstable_cache } from 'next/cache';
import { and, asc, eq, gte, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { buildPrintSheet, headingFor, type PrintSheet } from './print-sheet';
import { t } from './i18n';
import { addDaysStr, israelTodayStr } from './date-utils';
import { getOrderDisplay } from './asap';
import { awaitingApproval, overdue } from './order-attention';
import { DATA_TAG } from './cache-tags';
import { cacheEpoch, SAFETY_REVALIDATE_SECONDS } from './kitchen-screen';

/**
 * What the kitchen screen shows: the print sheet of every coming day, built by
 * buildPrintSheet itself so the screen and a printout can never disagree.
 * Today first (always, even empty, so tomorrow can't pass for today), then
 * every later day that has orders. Past days are left out; open orders still
 * on one are only counted (`overdue`), and so are the orders nobody approved
 * yet (`awaitingApproval`), so the screen can point to the app.
 *
 * Where the open בהקדם orders go follows the bakery's switch
 * (src/lib/asap.ts): inside today's sheet, first, or a card of their own
 * before it, with no mixing weights. The recipe switch rides along as
 * `showRecipe` so the screen can hide the לישה section.
 */

export type KitchenDayKind = 'asap' | 'today' | 'tomorrow' | 'later';
export interface KitchenDay {
  key: string;
  kind: KitchenDayKind;
  /** Null for the בהקדם card. */
  date: string | null;
  /** The heading, built here because this module can't be imported by the client component that shows it. */
  title: string;
  sheet: PrintSheet;
}
export interface KitchenData {
  today: string;
  builtAt: string;
  /** Whether the לישה (mixing weights) section is shown on the cards. */
  showRecipe: boolean;
  days: KitchenDay[];
  /** Counts only, by the rules the Telegram nudges use (src/lib/order-attention.ts). The Orders tab lists them. */
  overdue: number;
  awaitingApproval: number;
}

function dayTitle(kind: KitchenDayKind, date: string | null): string {
  if (kind === 'asap' || !date) return t('delivery.asap');
  const heading = headingFor(date);
  if (kind === 'today') return `${t('kitchen.today')} · ${heading}`;
  if (kind === 'tomorrow') return `${t('kitchen.tomorrow')} · ${heading}`;
  return heading;
}

async function countAttention(groupId: number, today: string): Promise<{ overdue: number; awaitingApproval: number }> {
  const [row] = await db
    .select({
      overdue: sql<number>`count(*) filter (where ${overdue(today)})::int`,
      awaitingApproval: sql<number>`count(*) filter (where ${awaitingApproval(today)})::int`,
    })
    .from(orders)
    .where(eq(orders.groupId, groupId));
  return { overdue: row?.overdue ?? 0, awaitingApproval: row?.awaitingApproval ?? 0 };
}

export async function loadKitchenData(groupId: number, today: string): Promise<KitchenData> {
  // Read on every build, so a flip of the switch shows on the next one.
  const display = await getOrderDisplay(groupId);
  const dated = await db
    .selectDistinct({ date: orders.deliveryDate })
    .from(orders)
    .where(and(eq(orders.groupId, groupId), gte(orders.deliveryDate, today), ne(orders.status, 'cancelled')))
    .orderBy(asc(orders.deliveryDate));
  const dates = [today, ...dated.map((r) => r.date).filter((d): d is string => !!d && d !== today)];
  const tomorrow = addDaysStr(today, 1);

  const [attention, asapSheet, ...sheets] = await Promise.all([
    countAttention(groupId, today),
    display.asapInToday ? null : buildPrintSheet(groupId, null, { undatedOnly: true }),
    ...dates.map((d) => buildPrintSheet(groupId, d, { withUndated: display.asapInToday && d === today })),
  ]);

  const days = dates.map((date, i): KitchenDay => {
    const kind: KitchenDayKind = date === today ? 'today' : date === tomorrow ? 'tomorrow' : 'later';
    return { key: date, kind, date, title: dayTitle(kind, date), sheet: sheets[i] };
  });
  if (asapSheet && asapSheet.orders.length > 0) {
    days.unshift({ key: 'asap', kind: 'asap', date: null, title: dayTitle('asap', null), sheet: asapSheet });
  }
  return { today, builtAt: new Date().toISOString(), showRecipe: display.kitchenShowRecipe, days, ...attention };
}

/** The Israel date is in the key, so the first check after midnight builds the new day. */
export function kitchenCacheKey(groupId: number, now: Date = new Date()): string[] {
  return ['kitchen-sheet', String(groupId), israelTodayStr(now), cacheEpoch()];
}

/** The saved copy; read again only after a save (or the two-hour safety re-read). */
export function getKitchenData(groupId: number, now: Date = new Date()): Promise<KitchenData> {
  const today = israelTodayStr(now);
  return unstable_cache(() => loadKitchenData(groupId, today), kitchenCacheKey(groupId, now), {
    tags: [DATA_TAG],
    revalidate: SAFETY_REVALIDATE_SECONDS,
  })();
}

export function kitchenStamp(data: KitchenData): string {
  return `${data.today}|${data.builtAt}`;
}
