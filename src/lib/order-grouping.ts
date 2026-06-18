import { formatDateRelative } from './date-utils';

export interface DatedOrder {
  deliveryDate: string | null;
  totalQuantity?: number;
}

export interface OrderGroup<T> {
  key: string;
  label: string;
  loaves: number;
  items: T[];
}

const ASAP_KEY = '__asap__';

/**
 * Group orders by delivery date, preserving the input order of date keys (so an
 * API-sorted list stays sorted). Each group carries a human date label (reusing
 * formatDateRelative — "היום" / "מחר" / "שבת הקרובה"…) and a loaf total. Orders
 * with no delivery date (ASAP) collapse into one trailing-labelled group.
 */
export function groupByDeliveryDate<T extends DatedOrder>(
  orders: T[],
  lang: 'en' | 'he'
): OrderGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const o of orders) {
    const key = o.deliveryDate ?? ASAP_KEY;
    const bucket = map.get(key);
    if (bucket) bucket.push(o);
    else map.set(key, [o]);
  }
  return [...map.entries()].map(([key, items]) => ({
    key,
    label: key === ASAP_KEY ? (lang === 'he' ? 'בהקדם' : 'ASAP') : formatDateRelative(key, lang),
    loaves: items.reduce((sum, o) => sum + (o.totalQuantity ?? 0), 0),
    items,
  }));
}
