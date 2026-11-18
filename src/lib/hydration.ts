import { isHomeMadeKind, priceKey, type HomeMadeSettings } from './cost';
import type { IngredientKind } from './recipe';

/**
 * Total hydration: the one hydration figure every surface shows.
 *
 * Pure, shared by client and server. Counts the flour and liquid hidden inside
 * home-made ingredients (starters, tangzhong) by their own hydration, so it
 * needs only the hydration — no prices, no flour name — and works for a baker
 * who cannot see money.
 */

/** priceKey -> hydrationPct, only for home-made rows that are set up (flour chosen). */
export type HydrationSplits = Record<string, number>;

export function hydrationSplits(rows: HomeMadeSettings[]): HydrationSplits {
  const out: HydrationSplits = {};
  for (const r of rows) {
    if (r.flourName) out[priceKey(r.name, r.kind)] = r.hydrationPct;
  }
  return out;
}

export function totalHydration(
  rows: { name: string; kind: IngredientKind; pct: number }[],
  splits: HydrationSplits
): { pct: number | null; leavesOut: string[] } {
  let flour = 0;
  let liquid = 0;
  const leavesOut: string[] = [];

  for (const r of rows) {
    const h = splits[priceKey(r.name, r.kind)];
    if (h !== undefined) {
      flour += (r.pct * 100) / (100 + h);
      liquid += (r.pct * h) / (100 + h);
    } else if (r.kind === 'flour') {
      flour += r.pct;
    } else if (r.kind === 'water') {
      liquid += r.pct;
    } else if (isHomeMadeKind(r.kind) && !leavesOut.includes(r.name)) {
      leavesOut.push(r.name);
    }
  }

  return { pct: flour > 0 && liquid > 0 ? (liquid / flour) * 100 : null, leavesOut };
}
