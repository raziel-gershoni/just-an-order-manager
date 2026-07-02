import type { Allocation } from './pricing';

type Translate = (key: string) => string;

/**
 * Turn a pricing Allocation row into a display label + line subtotal.
 * Shared by the order form (live) and the order detail page (frozen snapshot).
 */
export function formatAllocation(row: Allocation, t: Translate): { label: string; amount: number } {
  if (row.kind === 'pack') {
    const base = t('pricing.pack_of').replace('{qty}', String(row.qty));
    return { label: row.count > 1 ? `${base} × ${row.count}` : base, amount: row.amount * row.count };
  }
  if (row.kind === 'surcharge') {
    return { label: `${t('pricing.additions')} × ${row.count}`, amount: row.amount * row.count };
  }
  return { label: `${t('pricing.single_unit')} × ${row.count}`, amount: row.amount * row.count };
}
