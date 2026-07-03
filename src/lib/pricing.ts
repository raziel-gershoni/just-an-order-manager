// Pure bulk-pricing engine — the single source of truth for order goods totals.
// No DB, no i18n; fully unit-testable and safe to import on both server and client.
// All money is handled in integer agorot (cents) internally to avoid float drift,
// converted back to shekels only at the boundary.
//
// Model: a "size" (e.g. bun) may offer bulk tiers (6 → ₪40, 30 → ₪150). Prices are
// per bread type (base price on the size, overridable per type). A mixed pack is
// charged "go highest" — the priciest bread's tier price — and the allocator finds
// the CHEAPEST combination of tiers + singles for any quantity, concentrating the
// priciest breads into the fewest packs and leaving the cheapest as singles.

export type PricedUnit = {
  breadTypeId: number;
  unitPrice: number; // single (per-unit) shekel price for this (type, size)
  hasAdditions: boolean;
  chargeAdditions: boolean; // whether this unit's addition surcharge is charged
  tierPrice: Record<number, number>; // minQty -> pack shekel price for this (type, size)
};

export type SizeGroup = {
  breadSizeId: number;
  tierQtys: number[]; // pack sizes offered for this size; [] = no bundling (inert)
  units: PricedUnit[]; // every unit carries tierPrice for each q in tierQtys
};

export type Allocation =
  | { kind: 'pack'; qty: number; count: number; amount: number } // `count` packs of size `qty` at `amount` each
  | { kind: 'single'; qty: 1; count: number; amount: number } // `count` singles at `amount` each
  | { kind: 'surcharge'; qty: 0; count: number; amount: number }; // add-on units at `amount` each

const toC = (x: number) => Math.round(x * 100);
const toS = (c: number) => c / 100;
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Allocate one bundleable size to the cheapest combination of packs + singles.
 * Returns the base cost in cents (surcharge NOT applied — the caller adds it once),
 * the number of units carrying additions, and display rows.
 */
export function allocateSize(
  group: SizeGroup
): { baseCents: number; additionUnits: number; rows: Allocation[] } {
  const units = [...group.units].sort((a, b) => b.unitPrice - a.unitPrice); // desc by single price
  const n = units.length;
  // Only units whose addition surcharge is actually charged count toward it.
  const additionUnits = units.filter((u) => u.hasAdditions && u.chargeAdditions).length;

  const qtys = group.tierQtys.filter((q) => q >= 2);
  if (qtys.length === 0 || n === 0) {
    // Inert path: no tiers → every unit at its single price.
    let baseCents = 0;
    for (const u of units) baseCents += toC(u.unitPrice);
    return { baseCents, additionUnits, rows: singleRows(units) };
  }

  // DP over (i, s): min cents to place the first i units (sorted desc) while leaving
  // s open "free-rider" slots. A unit can be a single, fill an open slot for free, or
  // open a q-pack (it becomes the pack's leader — the priciest member, so its tier
  // price is the pack cost — creating q-1 slots filled by later, cheaper units).
  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(INF));
  const back: ({ kind: 'single' | 'fill' | 'pack'; q: number } | null)[][] = Array.from(
    { length: n + 1 },
    () => new Array(n + 1).fill(null)
  );
  dp[0][0] = 0;

  for (let i = 0; i < n; i++) {
    const u = units[i];
    const singleC = toC(u.unitPrice);
    for (let s = 0; s <= n; s++) {
      const cur = dp[i][s];
      if (cur === INF) continue;
      // 1) unit is a single
      if (cur + singleC < dp[i + 1][s]) {
        dp[i + 1][s] = cur + singleC;
        back[i + 1][s] = { kind: 'single', q: 1 };
      }
      // 2) unit fills an open slot (free rider)
      if (s > 0 && cur < dp[i + 1][s - 1]) {
        dp[i + 1][s - 1] = cur;
        back[i + 1][s - 1] = { kind: 'fill', q: 0 };
      }
      // 3) unit opens a q-pack as leader
      for (const q of qtys) {
        const pc = u.tierPrice[q];
        if (pc == null) continue;
        const ns = s + (q - 1);
        if (ns > n) continue; // can't need more free riders than remaining units
        const cost = cur + toC(pc);
        if (cost < dp[i + 1][ns]) {
          dp[i + 1][ns] = cost;
          back[i + 1][ns] = { kind: 'pack', q };
        }
      }
    }
  }

  const baseCents = dp[n][0]; // always finite: the all-singles path keeps s=0

  // Reconstruct the chosen packs + singles for the display breakdown.
  const packList: { q: number; amount: number }[] = [];
  const singlesCents: number[] = [];
  let i = n;
  let s = 0;
  while (i > 0) {
    const b = back[i][s];
    if (!b) break;
    const u = units[i - 1];
    if (b.kind === 'single') {
      singlesCents.push(toC(u.unitPrice));
      i -= 1;
    } else if (b.kind === 'fill') {
      i -= 1;
      s += 1;
    } else {
      packList.push({ q: b.q, amount: toC(u.tierPrice[b.q]) });
      i -= 1;
      s -= b.q - 1;
    }
  }

  return { baseCents, additionUnits, rows: buildRows(packList, singlesCents) };
}

function singleRows(units: PricedUnit[]): Allocation[] {
  const m = new Map<number, number>();
  for (const u of units) {
    const c = toC(u.unitPrice);
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([c, count]) => ({ kind: 'single', qty: 1, count, amount: toS(c) }));
}

function buildRows(packList: { q: number; amount: number }[], singlesCents: number[]): Allocation[] {
  const rows: Allocation[] = [];
  const pm = new Map<string, number>();
  for (const p of packList) {
    const k = `${p.q}|${p.amount}`;
    pm.set(k, (pm.get(k) ?? 0) + 1);
  }
  const packEntries = [...pm.entries()]
    .map(([k, count]) => {
      const [q, amt] = k.split('|').map(Number);
      return { q, amount: amt, count };
    })
    .sort((a, b) => b.q - a.q || b.amount - a.amount);
  for (const p of packEntries) rows.push({ kind: 'pack', qty: p.q, count: p.count, amount: toS(p.amount) });

  const sm = new Map<number, number>();
  for (const c of singlesCents) sm.set(c, (sm.get(c) ?? 0) + 1);
  for (const [c, count] of [...sm.entries()].sort((a, b) => b[0] - a[0]))
    rows.push({ kind: 'single', qty: 1, count, amount: toS(c) });
  return rows;
}

// ---- Order-level pricing ----

export type OrderLine = {
  breadTypeId: number;
  breadSizeId: number | null;
  quantity: number;
  unitPrice: number;
  hasAdditions: boolean;
  chargeAdditions: boolean; // per-line: false = this line's additions are free
  tierPrices: Record<number, number>; // minQty -> effective pack price for this (type, size)
};

export type OrderPricingInput = {
  lines: OrderLine[];
  tierQtysBySize: Record<number, number[]>; // sizeId -> pack sizes offered; missing/[] = no bundling
  surcharge: number;
  dealsEnabled: boolean;
  deliveryFee: number;
  totalOverride: number | null;
};

export type OrderPricing = {
  goods: number;
  deliveryFee: number;
  total: number;
  rows: Allocation[];
};

/**
 * Price a whole order. Pools units by size, allocates bundleable sizes, sums the
 * rest as singles, applies the flat additions surcharge once per add-on unit, then
 * folds in the order override and delivery fee with a single consistent rule.
 */
export function computeOrderPricing(input: OrderPricingInput): OrderPricing {
  const { lines, tierQtysBySize, surcharge, dealsEnabled, deliveryFee, totalOverride } = input;

  const bySize = new Map<number, PricedUnit[]>();
  const nullSizeUnits: PricedUnit[] = [];
  for (const l of lines) {
    for (let k = 0; k < l.quantity; k++) {
      const u: PricedUnit = {
        breadTypeId: l.breadTypeId,
        unitPrice: l.unitPrice,
        hasAdditions: l.hasAdditions,
        chargeAdditions: l.chargeAdditions,
        tierPrice: l.tierPrices,
      };
      if (l.breadSizeId == null) nullSizeUnits.push(u);
      else {
        const arr = bySize.get(l.breadSizeId) ?? [];
        arr.push(u);
        bySize.set(l.breadSizeId, arr);
      }
    }
  }

  let baseCents = 0;
  let additionUnits = 0;
  const rows: Allocation[] = [];

  for (const [sizeId, units] of bySize) {
    const tierQtys = dealsEnabled ? tierQtysBySize[sizeId] ?? [] : [];
    const res = allocateSize({ breadSizeId: sizeId, tierQtys, units });
    baseCents += res.baseCents;
    additionUnits += res.additionUnits;
    rows.push(...res.rows);
  }
  if (nullSizeUnits.length) {
    const res = allocateSize({ breadSizeId: -1, tierQtys: [], units: nullSizeUnits });
    baseCents += res.baseCents;
    additionUnits += res.additionUnits;
    rows.push(...res.rows);
  }

  const surchargeCents = toC(surcharge) * additionUnits;
  if (surchargeCents > 0) rows.push({ kind: 'surcharge', qty: 0, count: additionUnits, amount: surcharge });

  const goods = toS(baseCents + surchargeCents);
  const total = (totalOverride != null ? totalOverride : goods) + deliveryFee;
  return { goods: round2(goods), deliveryFee: round2(deliveryFee), total: round2(total), rows };
}
