import { db } from '@/db';
import {
  homeMadeIngredients,
  breadTypes,
  breadSizes,
  breadTypeSizes,
  breadRecipeIngredients,
  ingredientPrices,
} from '@/db/schema';
import { eq, and, inArray, asc } from 'drizzle-orm';
import type { IngredientKind } from './recipe';
import { isHomeMadeKind, priceKey, type HomeMadeKind, type HomeMadeSettings, type PriceBook } from './cost';
import { hydrationSplits, type HydrationSplits } from './hydration';

/**
 * Reading everything the cost screen needs.
 *
 * Shaped like loadGroupTiers in order-pricing.ts: thin DB wrappers feeding a
 * pure engine (src/lib/cost.ts), so the route stays auth → load → delegate.
 *
 * Note what is NOT here: the per-loaf arithmetic. The screen recomputes costs
 * as the owner types, so the math has to run on the client anyway — and one
 * implementation used from both sides beats a server copy that drifts.
 */

/** A saved price exactly as the editor round-trips it — decimal string, not float. */
export interface PriceRow {
  name: string;
  kind: IngredientKind;
  pricePerKg: string;
}

export interface InUseIngredient {
  name: string;
  kind: IngredientKind;
  /** Bread types whose recipe contains it — the owner's answer to "what is this for?". */
  usedBy: string[];
}

/** One bread with everything needed to cost it, and nothing else. */
export interface BreadForCosting {
  breadTypeId: number;
  breadTypeName: string;
  isActive: boolean;
  ingredients: {
    name: string;
    kind: IngredientKind;
    pctOfFinished: number;
    sortOrder: number;
  }[];
  sizes: { sizeId: number; sizeName: string; weightGrams: number | null }[];
}

export async function loadPriceRows(groupId: number): Promise<PriceRow[]> {
  return db
    .select({
      name: ingredientPrices.name,
      kind: ingredientPrices.kind,
      pricePerKg: ingredientPrices.pricePerKg,
    })
    .from(ingredientPrices)
    .where(eq(ingredientPrices.groupId, groupId));
}

/** Every home-made ingredient's settings, ordered by kind then name. */
export async function loadHomeMade(groupId: number): Promise<HomeMadeSettings[]> {
  const rows = await db
    .select({
      name: homeMadeIngredients.name,
      kind: homeMadeIngredients.kind,
      flourName: homeMadeIngredients.flourName,
      liquidName: homeMadeIngredients.liquidName,
      liquidKind: homeMadeIngredients.liquidKind,
      hydrationPct: homeMadeIngredients.hydrationPct,
      wasteFactor: homeMadeIngredients.wasteFactor,
    })
    .from(homeMadeIngredients)
    .where(eq(homeMadeIngredients.groupId, groupId))
    .orderBy(asc(homeMadeIngredients.kind), asc(homeMadeIngredients.name));

  return rows.map((r) => ({
    name: r.name,
    // The table's CHECKs limit these to starter/tangzhong and water/other.
    kind: r.kind as HomeMadeSettings['kind'],
    flourName: r.flourName,
    liquidName: r.liquidName,
    liquidKind: r.liquidKind as HomeMadeSettings['liquidKind'],
    hydrationPct: r.hydrationPct,
    wasteFactor: Number(r.wasteFactor),
  }));
}

export async function loadPriceBook(groupId: number): Promise<PriceBook> {
  const [rows, homeMade] = await Promise.all([loadPriceRows(groupId), loadHomeMade(groupId)]);

  const pricePerKg: Record<string, number> = {};
  for (const row of rows) {
    pricePerKg[priceKey(row.name, row.kind)] = Number(row.pricePerKg);
  }

  return {
    pricePerKg,
    homeMade: Object.fromEntries(homeMade.map((h) => [priceKey(h.name, h.kind), h])),
  };
}

/** What total hydration needs from the settings: no money, so bakers may have it. */
export async function loadHydrationSplits(groupId: number): Promise<HydrationSplits> {
  return hydrationSplits(await loadHomeMade(groupId));
}

/**
 * Every (name, kind) that appears in any recipe in the group.
 *
 * Deliberately WITHOUT an isActive filter on bread types, unlike
 * GET /api/recipes: aggregateRecipesForOrders has no such filter either, so a
 * deactivated bread sitting on a live order still gets weighed out and still
 * needs costing. Its ingredients must appear in the price list.
 */
export async function loadIngredientsInUse(groupId: number): Promise<InUseIngredient[]> {
  const rows = await db
    .select({
      name: breadRecipeIngredients.name,
      kind: breadRecipeIngredients.kind,
      breadTypeName: breadTypes.name,
    })
    .from(breadRecipeIngredients)
    .innerJoin(breadTypes, eq(breadTypes.id, breadRecipeIngredients.breadTypeId))
    .where(eq(breadTypes.groupId, groupId))
    // usedBy lists the breads in menu order (the screen shows the first three).
    .orderBy(asc(breadTypes.sortOrder), asc(breadTypes.id), asc(breadRecipeIngredients.sortOrder));

  const byKey = new Map<string, InUseIngredient>();
  for (const row of rows) {
    const key = priceKey(row.name, row.kind);
    const entry = byKey.get(key) ?? { name: row.name, kind: row.kind, usedBy: [] };
    if (!entry.usedBy.includes(row.breadTypeName)) entry.usedBy.push(row.breadTypeName);
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

/**
 * The prices screen's list: what recipes use, plus every flour and liquid a
 * saved home-made entry is made from that no recipe lists (a rye starter is fed
 * rye flour no bread has on its own). Those carry the entry names as `usedBy`.
 */
export async function loadIngredientsForPricing(groupId: number): Promise<InUseIngredient[]> {
  const [inUse, homeMade] = await Promise.all([loadIngredientsInUse(groupId), loadHomeMade(groupId)]);
  const byKey = new Map(inUse.map((i) => [priceKey(i.name, i.kind), i]));
  const out = [...inUse];
  const feed = (name: string, kind: IngredientKind, entry: string) => {
    const key = priceKey(name, kind);
    let item = byKey.get(key);
    if (!item) {
      item = { name, kind, usedBy: [] };
      byKey.set(key, item);
      out.push(item);
    } else if (inUse.includes(item)) {
      return; // a recipe already lists it
    }
    if (!item.usedBy.includes(entry)) item.usedBy.push(entry);
  };
  for (const h of homeMade) {
    if (h.flourName) feed(h.flourName, 'flour', h.name);
    feed(h.liquidName, h.liquidKind, h.name);
  }
  return out;
}

/**
 * A saved price whose ingredient is on no list the screen shows. Free-text
 * ingredient names mean a typo mints a new identity and orphans the old price;
 * showing orphans is how that becomes visible the day it happens.
 */
export function orphanPrices(prices: PriceRow[], listed: { name: string; kind: IngredientKind }[]): PriceRow[] {
  const keys = new Set(listed.map((i) => priceKey(i.name, i.kind)));
  return prices.filter((p) => !keys.has(priceKey(p.name, p.kind)));
}

export interface HomeMadeEntry {
  name: string;
  kind: HomeMadeKind;
  /** Null for a starter or tangzhong a recipe uses that has no settings yet. */
  saved: HomeMadeSettings | null;
  usedBy: string[];
  /**
   * Recipes that use this name under another kind (a tangzhong row left as
   * "אחר"). Nothing links them to this entry until the row's kind is changed,
   * so the section says so instead of pricing an entry no loaf uses.
   */
  otherKind: { kind: IngredientKind; usedBy: string[] }[];
}

export interface HomeMadeCatalog {
  entries: HomeMadeEntry[];
  flourOptions: string[];
  liquidOptions: { name: string; kind: 'water' | 'other' }[];
  book: PriceBook;
}

/** What the catalogue's "מכינים בעצמנו" section reads: entries plus the pickers' options. */
export async function loadHomeMadeCatalog(groupId: number): Promise<HomeMadeCatalog> {
  const [inUse, homeMade, prices, book] = await Promise.all([
    loadIngredientsInUse(groupId),
    loadHomeMade(groupId),
    loadPriceRows(groupId),
    loadPriceBook(groupId),
  ]);
  const usedByKey = new Map(inUse.map((i) => [priceKey(i.name, i.kind), i.usedBy]));

  const otherKind = (name: string, kind: IngredientKind) =>
    inUse.filter((i) => i.name === name && i.kind !== kind).map((i) => ({ kind: i.kind, usedBy: i.usedBy }));
  const entries: HomeMadeEntry[] = homeMade.map((h) => ({
    name: h.name,
    kind: h.kind,
    saved: h,
    usedBy: usedByKey.get(priceKey(h.name, h.kind)) ?? [],
    otherKind: otherKind(h.name, h.kind),
  }));
  const savedKeys = new Set(homeMade.map((h) => priceKey(h.name, h.kind)));
  for (const i of inUse) {
    if (isHomeMadeKind(i.kind) && !savedKeys.has(priceKey(i.name, i.kind))) {
      entries.push({ name: i.name, kind: i.kind, saved: null, usedBy: i.usedBy, otherKind: otherKind(i.name, i.kind) });
    }
  }
  entries.sort(
    (a, b) => Number(a.kind !== 'starter') - Number(b.kind !== 'starter') || a.name.localeCompare(b.name, 'he')
  );

  const flours = new Set<string>();
  for (const i of inUse) if (i.kind === 'flour') flours.add(i.name);
  for (const p of prices) if (p.kind === 'flour') flours.add(p.name);
  for (const h of homeMade) if (h.flourName) flours.add(h.flourName);

  const liquids = new Map<string, { name: string; kind: 'water' | 'other' }>();
  const addLiquid = (name: string, kind: IngredientKind) => {
    if (kind !== 'water' && kind !== 'other') return;
    liquids.set(priceKey(name, kind), { name, kind });
  };
  for (const i of inUse) addLiquid(i.name, i.kind);
  for (const p of prices) addLiquid(p.name, p.kind);
  // What a saved entry already uses stays offered, whatever it is now.
  for (const h of homeMade) liquids.set(priceKey(h.liquidName, h.liquidKind), { name: h.liquidName, kind: h.liquidKind });

  return {
    entries,
    flourOptions: [...flours].sort((a, b) => a.localeCompare(b, 'he')),
    liquidOptions: [...liquids.values()].sort(
      (a, b) => Number(a.kind !== 'water') - Number(b.kind !== 'water') || a.name.localeCompare(b.name, 'he')
    ),
    book,
  };
}

/**
 * Recipe name suggestions by kind: every name in the recipes plus every saved
 * home-made entry under its kind, so a baker can pick "מחמצת שיפון" before any
 * recipe uses it.
 */
export function buildNamesByKind(
  recipeRows: { name: string; kind: IngredientKind }[],
  homeMade: { name: string; kind: IngredientKind }[]
): Record<IngredientKind, string[]> {
  const out: Record<IngredientKind, string[]> = { flour: [], water: [], salt: [], starter: [], tangzhong: [], other: [] };
  for (const r of [...recipeRows, ...homeMade]) {
    if (!out[r.kind].includes(r.name)) out[r.kind].push(r.name);
  }
  for (const kind of Object.keys(out) as IngredientKind[]) out[kind].sort((a, b) => a.localeCompare(b, 'he'));
  return out;
}

/** Every bread with its recipe percentages and its enabled sizes' weights. */
export async function loadBreadsForCosting(groupId: number): Promise<BreadForCosting[]> {
  const types = await db
    .select({ id: breadTypes.id, name: breadTypes.name, isActive: breadTypes.isActive })
    .from(breadTypes)
    .where(eq(breadTypes.groupId, groupId))
    .orderBy(asc(breadTypes.sortOrder), asc(breadTypes.id));
  if (types.length === 0) return [];

  const typeIds = types.map((t) => t.id);

  const [ingredientRows, sizeRows] = await Promise.all([
    db
      .select({
        breadTypeId: breadRecipeIngredients.breadTypeId,
        name: breadRecipeIngredients.name,
        kind: breadRecipeIngredients.kind,
        pctOfFinished: breadRecipeIngredients.pctOfFinished,
        sortOrder: breadRecipeIngredients.sortOrder,
      })
      .from(breadRecipeIngredients)
      .where(inArray(breadRecipeIngredients.breadTypeId, typeIds))
      .orderBy(asc(breadRecipeIngredients.sortOrder), asc(breadRecipeIngredients.id)),
    db
      .select({
        breadTypeId: breadTypeSizes.breadTypeId,
        sizeId: breadSizes.id,
        sizeName: breadSizes.name,
        weightGrams: breadSizes.weightGrams,
        sortOrder: breadTypeSizes.sortOrder,
      })
      .from(breadTypeSizes)
      .innerJoin(breadSizes, eq(breadSizes.id, breadTypeSizes.breadSizeId))
      .where(and(inArray(breadTypeSizes.breadTypeId, typeIds), eq(breadSizes.isActive, true)))
      .orderBy(asc(breadTypeSizes.sortOrder), asc(breadSizes.sortOrder), asc(breadSizes.id)),
  ]);

  return types.map((type) => ({
    breadTypeId: type.id,
    breadTypeName: type.name,
    isActive: type.isActive,
    ingredients: ingredientRows
      .filter((r) => r.breadTypeId === type.id)
      .map((r) => ({
        name: r.name,
        kind: r.kind,
        pctOfFinished: Number(r.pctOfFinished),
        sortOrder: r.sortOrder,
      })),
    sizes: sizeRows
      .filter((s) => s.breadTypeId === type.id)
      .map((s) => ({ sizeId: s.sizeId, sizeName: s.sizeName, weightGrams: s.weightGrams })),
  }));
}
