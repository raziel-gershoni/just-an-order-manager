import { unstable_cache } from 'next/cache';
import { and, asc, eq, gte, ne } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { buildPrintSheet, headingFor, type PrintSheet } from './print-sheet';
import { t } from './i18n';
import { addDaysStr, israelTodayStr } from './date-utils';
import { DATA_TAG } from './cache-tags';
import { cacheEpoch, SAFETY_REVALIDATE_SECONDS } from './kitchen-screen';

/**
 * What the kitchen screen shows: the print sheet of every coming day, built by
 * buildPrintSheet itself so the screen and a printout can never disagree.
 * Today first (always, even empty, so tomorrow can't pass for today), holding
 * the open בהקדם orders too, then every later day that has orders. Past days
 * are left out.
 */

export type KitchenDayKind = 'today' | 'tomorrow' | 'later';
export interface KitchenDay {
  key: string;
  kind: KitchenDayKind;
  date: string;
  /** The heading, built here because this module can't be imported by the client component that shows it. */
  title: string;
  sheet: PrintSheet;
}
export interface KitchenData {
  today: string;
  builtAt: string;
  days: KitchenDay[];
}

function dayTitle(kind: KitchenDayKind, date: string): string {
  const heading = headingFor(date);
  if (kind === 'today') return `${t('kitchen.today')} · ${heading}`;
  if (kind === 'tomorrow') return `${t('kitchen.tomorrow')} · ${heading}`;
  return heading;
}

export async function loadKitchenData(groupId: number, today: string): Promise<KitchenData> {
  const dated = await db
    .selectDistinct({ date: orders.deliveryDate })
    .from(orders)
    .where(and(eq(orders.groupId, groupId), gte(orders.deliveryDate, today), ne(orders.status, 'cancelled')))
    .orderBy(asc(orders.deliveryDate));
  const dates = [today, ...dated.map((r) => r.date).filter((d): d is string => !!d && d !== today)];
  const tomorrow = addDaysStr(today, 1);

  const sheets = await Promise.all(dates.map((d) => buildPrintSheet(groupId, d, { withUndated: d === today })));

  const days = dates.map((date, i): KitchenDay => {
    const kind: KitchenDayKind = date === today ? 'today' : date === tomorrow ? 'tomorrow' : 'later';
    return { key: date, kind, date, title: dayTitle(kind, date), sheet: sheets[i] };
  });
  return { today, builtAt: new Date().toISOString(), days };
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
