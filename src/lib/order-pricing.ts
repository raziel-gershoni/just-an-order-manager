// DB-facing wrapper around the pure pricing engine (src/lib/pricing.ts).
// Loads a group's bulk tiers and turns order lines into an engine input, so
// every read/write site prices through one code path.

import { db } from '@/db';
import { breadSizeTiers } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { computeOrderPricing, type OrderLine, type Allocation } from './pricing';

export type { Allocation } from './pricing';

export type GroupTiers = {
  /** sizeId -> the pack sizes offered (union of all defined tier minQtys). */
  tierQtysBySize: Record<number, number[]>;
  /** Effective tier prices for a (type, size): minQty -> price (per-type override else size default). */
  tierPricesFor: (breadTypeId: number, breadSizeId: number) => Record<number, number>;
};

/** Load and index a group's tiers: default rows (null bread) + per-type overrides. */
export async function loadGroupTiers(groupId: number): Promise<GroupTiers> {
  const rows = await db
    .select()
    .from(breadSizeTiers)
    .where(eq(breadSizeTiers.groupId, groupId));

  // sizeId -> minQty -> { def?: number; byType: Map<typeId, number> }
  const bySize = new Map<number, Map<number, { def?: number; byType: Map<number, number> }>>();
  const qtysBySize = new Map<number, Set<number>>();

  for (const r of rows) {
    const sizeId = r.breadSizeId;
    const q = r.minQty;
    const price = Number(r.price);
    if (!bySize.has(sizeId)) bySize.set(sizeId, new Map());
    const qm = bySize.get(sizeId)!;
    if (!qm.has(q)) qm.set(q, { byType: new Map() });
    const cell = qm.get(q)!;
    if (r.breadTypeId == null) cell.def = price;
    else cell.byType.set(r.breadTypeId, price);
    if (!qtysBySize.has(sizeId)) qtysBySize.set(sizeId, new Set());
    qtysBySize.get(sizeId)!.add(q);
  }

  const tierQtysBySize: Record<number, number[]> = {};
  for (const [sizeId, set] of qtysBySize) tierQtysBySize[sizeId] = [...set].sort((a, b) => a - b);

  const tierPricesFor = (breadTypeId: number, breadSizeId: number): Record<number, number> => {
    const out: Record<number, number> = {};
    const qm = bySize.get(breadSizeId);
    if (!qm) return out;
    for (const [q, cell] of qm) {
      const p = cell.byType.get(breadTypeId) ?? cell.def;
      if (p != null) out[q] = p;
    }
    return out;
  };

  return { tierQtysBySize, tierPricesFor };
}

export type WriteLine = {
  breadTypeId: number;
  breadSizeId: number | null;
  quantity: number;
  unitPrice: number; // base single price (priceOverride ?? size.price), WITHOUT surcharge
  hasAdditions: boolean;
};

/**
 * Compute an order's goods total + display breakdown for snapshotting at write time.
 * With no tiers (or dealsEnabled=false) this equals the plain Σ qty×(unit+surcharge).
 */
export async function priceOrderForWrite(
  groupId: number,
  lines: WriteLine[],
  opts: {
    dealsEnabled: boolean;
    chargeAdditions: boolean;
    deliveryFee: number;
    totalOverride: number | null;
    surcharge: number;
  }
): Promise<{ goods: number; total: number; rows: Allocation[] }> {
  const tiers = await loadGroupTiers(groupId);
  const engineLines: OrderLine[] = lines.map((l) => ({
    breadTypeId: l.breadTypeId,
    breadSizeId: l.breadSizeId,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    hasAdditions: l.hasAdditions,
    tierPrices: l.breadSizeId != null ? tiers.tierPricesFor(l.breadTypeId, l.breadSizeId) : {},
  }));
  const res = computeOrderPricing({
    lines: engineLines,
    tierQtysBySize: tiers.tierQtysBySize,
    surcharge: opts.surcharge,
    chargeAdditions: opts.chargeAdditions,
    dealsEnabled: opts.dealsEnabled,
    deliveryFee: opts.deliveryFee,
    totalOverride: opts.totalOverride,
  });
  return { goods: res.goods, total: res.total, rows: res.rows };
}

/**
 * Goods subtotal for a placed order on READ. Prefers the frozen snapshot; falls
 * back to Σ qty×pricePerUnit for legacy orders (pre-snapshot) — identical to the
 * previous behavior, so nothing already placed changes.
 */
export function goodsForRead(
  order: { goodsSnapshot: string | null },
  items: { quantity: number; pricePerUnit: string | null }[]
): number {
  if (order.goodsSnapshot != null) return Number(order.goodsSnapshot);
  return items.reduce((s, i) => s + i.quantity * Number(i.pricePerUnit || 0), 0);
}

/** Full order total on READ: (totalOverride ?? goods) + delivery fee — the one consistent rule. */
export function orderTotalForRead(
  order: { goodsSnapshot: string | null; totalOverride: string | null; deliveryFee: string | null },
  items: { quantity: number; pricePerUnit: string | null }[]
): number {
  const goods = order.totalOverride != null ? Number(order.totalOverride) : goodsForRead(order, items);
  return goods + Number(order.deliveryFee || 0);
}
