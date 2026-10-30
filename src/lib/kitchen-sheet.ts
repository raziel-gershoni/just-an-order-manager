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
 * בהקדם first, then today (always, even empty, so tomorrow can't pass for
 * today), then every later day that has orders. Past days are left out.
 */

export type KitchenDayKind = 'asap' | 'today' | 'tomorrow' | 'later';
export interface KitchenDay {
  key: string;
  kind: KitchenDayKind;
  date: string | null;
  /** The heading, built here because this module can't be imported by the client component that shows it. */
  title: string;
  sheet: PrintSheet;
}
export interface KitchenData {
  today: string;
  builtAt: string;
  days: KitchenDay[];
}

function dayTitle(kind: KitchenDayKind, date: string | null): string {
  if (kind === 'asap') return t('kitchen.asap');
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

  const [asap, ...sheets] = await Promise.all([
    buildPrintSheet(groupId, null, { undatedOnly: true }),
    ...dates.map((d) => buildPrintSheet(groupId, d)),
  ]);

  const days: KitchenDay[] = [];
  if (asap.orders.length > 0) days.push({ key: 'asap', kind: 'asap', date: null, title: dayTitle('asap', null), sheet: asap });
  dates.forEach((date, i) => {
    const kind: KitchenDayKind = date === today ? 'today' : date === tomorrow ? 'tomorrow' : 'later';
    days.push({ key: date, kind, date, title: dayTitle(kind, date), sheet: sheets[i] });
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
