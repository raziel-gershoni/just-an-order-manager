import { formatDateRelative } from './date-utils';
import { t } from './i18n';

export interface DatedOrder {
  id: number;
  deliveryDate: string | null;
  status?: string;
  totalQuantity?: number;
}

export interface OrderGroup<T> {
  key: string;
  label: string;
  loaves: number;
  items: T[];
}

export interface GroupingOptions {
  /** The bakery's calendar day, from the server (never the device clock). */
  today: string;
  /** The bakery's switch (groups.asap_in_today, read in src/lib/asap.ts). */
  asapInToday: boolean;
  /** Which way the list reads: soonest first (open orders) or latest first (history). */
  order: 'soonest' | 'latest';
}

export const ASAP_GROUP_KEY = '__asap__';

const CLOSED = ['delivered', 'cancelled'];
const byId = <T extends { id: number }>(a: T, b: T) => a.id - b.id;

/**
 * Group orders by delivery date, keeping the input order of the dates (so an
 * API-sorted list stays sorted), each group with its label and loaf total.
 *
 * Orders with no date follow the bakery's switch (src/lib/asap.ts), oldest
 * first: with it off they form one בהקדם group just before today (where today
 * would be when nothing is dated today); with it on, the open ones lead today's
 * group instead, creating it if needed. Closed undated orders (cancelled, old
 * delivered rows) are never today, so they keep the בהקדם group either way.
 */
export function groupByDeliveryDate<T extends DatedOrder>(
  orders: T[],
  lang: 'en' | 'he',
  opts: GroupingOptions
): OrderGroup<T>[] {
  const { today, asapInToday, order } = opts;
  const dated = new Map<string, T[]>();
  const openUndated: T[] = [];
  const closedUndated: T[] = [];
  for (const o of orders) {
    if (o.deliveryDate) {
      const bucket = dated.get(o.deliveryDate);
      if (bucket) bucket.push(o);
      else dated.set(o.deliveryDate, [o]);
    } else if (o.status && CLOSED.includes(o.status)) closedUndated.push(o);
    else openUndated.push(o);
  }
  const keys = [...dated.keys()];
  // Where today sits, or would sit, in this list's reading order.
  const todayAt = () => {
    const i = keys.indexOf(today);
    if (i !== -1) return i;
    const after = keys.findIndex((k) => (order === 'soonest' ? k > today : k < today));
    return after === -1 ? keys.length : after;
  };
  const asapItems = asapInToday ? closedUndated : [...openUndated, ...closedUndated];
  if (asapInToday && openUndated.length > 0) {
    if (!dated.has(today)) keys.splice(todayAt(), 0, today);
    dated.set(today, [...openUndated.sort(byId), ...(dated.get(today) ?? [])]);
  }
  if (asapItems.length > 0) keys.splice(todayAt(), 0, ASAP_GROUP_KEY);
  return keys.map((key) => {
    const items = key === ASAP_GROUP_KEY ? asapItems.sort(byId) : dated.get(key)!;
    return {
      key,
      label: key === ASAP_GROUP_KEY ? t('delivery.asap', lang) : formatDateRelative(key, lang),
      loaves: items.reduce((sum, o) => sum + (o.totalQuantity ?? 0), 0),
      items,
    };
  });
}

/** The items line for a row: an undated order outside the בהקדם group says so first. */
export function rowItemsLine(o: { deliveryDate: string | null }, itemsSummary: string, groupKey: string, lang: 'en' | 'he'): string {
  return o.deliveryDate == null && groupKey !== ASAP_GROUP_KEY ? `${t('delivery.asap', lang)} · ${itemsSummary}` : itemsSummary;
}
