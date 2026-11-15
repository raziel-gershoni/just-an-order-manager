import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  breadAdditions,
  breadRecipes,
  breadSizeTiers,
  breadSizes,
  breadTypeAdditions,
  breadTypeSizes,
  breadTypes,
  groups,
} from '@/db/schema';
import { israelToday } from '@/lib/date-utils';
import { loadBreadsForCosting, loadIngredientsInUse, loadPriceBook, loadPriceRows } from '@/lib/ingredient-costs';
import { costScaledRecipe, priceKey, starterPricePerKg } from '@/lib/cost';
import { buildIncomeReport } from '@/lib/income-report';
import { KIND_DISPLAY_ORDER, scaleRecipe, withBakersPercents, type IngredientKind } from '@/lib/recipe';
import { hydrationPct } from '@/lib/proposals/kinds';

/**
 * What the bakery MCP lets Claude read. Every function is scoped to one bakery
 * and returns plain JSON-able objects: money as "12.50" strings, every list in
 * a fixed order. The numbers come from the same loaders and maths as the mini
 * app's screens, so Claude sees what the owner sees.
 */

/** A bad argument Claude can fix: its message is passed back as the tool's error. */
export class ToolInputError extends Error {}

const money = (n: number) => n.toFixed(2);
const kindRank = (kind: IngredientKind) => KIND_DISPLAY_ORDER.indexOf(kind);
const byName = (a: string, b: string) => a.localeCompare(b, 'he');

// ---- list_breads ----

export interface BreadSizeView {
  sizeId: number;
  name: string;
  weightGrams: number | null;
  sizeActive: boolean;
  /** The size's own price: what every bread without its own price charges. */
  sizePrice: string;
  /** This bread's own price for the size, when it has one. */
  override: string | null;
  /** The price that applies to this bread at this size. */
  price: string;
}

export interface BreadView {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
  sizes: BreadSizeView[];
  /** Size-wide deals for the sizes this bread offers, then the bread's own deals. */
  deals: { dealScope: 'size' | 'bread'; breadSizeId: number; minQty: number; price: string }[];
  additions: { id: number; name: string }[];
}

export async function listBreads(groupId: number): Promise<{ additionsSurcharge: string; breads: BreadView[] }> {
  const types = await db
    .select()
    .from(breadTypes)
    .where(eq(breadTypes.groupId, groupId))
    .orderBy(asc(breadTypes.sortOrder), asc(breadTypes.id));
  const [group] = await db
    .select({ additionsSurcharge: groups.additionsSurcharge })
    .from(groups)
    .where(eq(groups.id, groupId));
  const additionsSurcharge = Number(group?.additionsSurcharge ?? 0).toFixed(2);
  if (types.length === 0) return { additionsSurcharge, breads: [] };

  const typeIds = types.map((t) => t.id);
  const [links, tiers, additions] = await Promise.all([
    db
      .select({
        breadTypeId: breadTypeSizes.breadTypeId,
        sizeId: breadSizes.id,
        name: breadSizes.name,
        weightGrams: breadSizes.weightGrams,
        sizeActive: breadSizes.isActive,
        sizePrice: breadSizes.price,
        override: breadTypeSizes.priceOverride,
      })
      .from(breadTypeSizes)
      .innerJoin(breadSizes, eq(breadSizes.id, breadTypeSizes.breadSizeId))
      .where(and(inArray(breadTypeSizes.breadTypeId, typeIds), eq(breadSizes.groupId, groupId)))
      .orderBy(asc(breadTypeSizes.sortOrder), asc(breadSizes.sortOrder), asc(breadSizes.id)),
    db
      .select()
      .from(breadSizeTiers)
      .where(eq(breadSizeTiers.groupId, groupId))
      .orderBy(asc(breadSizeTiers.breadSizeId), asc(breadSizeTiers.minQty), asc(breadSizeTiers.id)),
    db
      .select({
        breadTypeId: breadTypeAdditions.breadTypeId,
        id: breadAdditions.id,
        name: breadAdditions.name,
      })
      .from(breadTypeAdditions)
      .innerJoin(breadAdditions, eq(breadAdditions.id, breadTypeAdditions.breadAdditionId))
      .where(
        and(
          inArray(breadTypeAdditions.breadTypeId, typeIds),
          eq(breadAdditions.groupId, groupId),
          eq(breadAdditions.isActive, true)
        )
      )
      .orderBy(asc(breadTypeAdditions.sortOrder), asc(breadAdditions.sortOrder), asc(breadAdditions.id)),
  ]);

  const breads = types.map((type): BreadView => {
    const sizes = links
      .filter((l) => l.breadTypeId === type.id)
      .map((l) => ({
        sizeId: l.sizeId,
        name: l.name,
        weightGrams: l.weightGrams,
        sizeActive: l.sizeActive,
        sizePrice: money(Number(l.sizePrice)),
        override: l.override === null ? null : money(Number(l.override)),
        price: money(Number(l.override ?? l.sizePrice)),
      }));
    const offered = new Set(sizes.map((s) => s.sizeId));
    const deal = (scope: 'size' | 'bread') => (tier: (typeof tiers)[number]) => ({
      dealScope: scope,
      breadSizeId: tier.breadSizeId,
      minQty: tier.minQty,
      price: money(Number(tier.price)),
    });
    return {
      id: type.id,
      name: type.name,
      description: type.description,
      active: type.isActive,
      sizes,
      deals: [
        ...tiers.filter((x) => x.breadTypeId === null && offered.has(x.breadSizeId)).map(deal('size')),
        ...tiers.filter((x) => x.breadTypeId === type.id).map(deal('bread')),
      ],
      additions: additions.filter((a) => a.breadTypeId === type.id).map((a) => ({ id: a.id, name: a.name })),
    };
  });
  return { additionsSurcharge, breads };
}

// ---- get_recipes ----

export interface RecipeView {
  breadTypeId: number;
  name: string;
  updatedAt: string;
  hydrationPct: number;
  ingredients: { name: string; kind: IngredientKind; pctOfFinished: number; bakersPct: number }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function getRecipes(groupId: number, breadTypeId?: number): Promise<RecipeView[]> {
  const [breads, stamps] = await Promise.all([
    loadBreadsForCosting(groupId),
    db
      .select({ breadTypeId: breadRecipes.breadTypeId, updatedAt: breadRecipes.updatedAt })
      .from(breadRecipes)
      .innerJoin(breadTypes, eq(breadTypes.id, breadRecipes.breadTypeId))
      .where(eq(breadTypes.groupId, groupId)),
  ]);
  const updated = new Map(stamps.map((s) => [s.breadTypeId, s.updatedAt]));
  const out: RecipeView[] = [];
  for (const bread of breads) {
    if (breadTypeId !== undefined && bread.breadTypeId !== breadTypeId) continue;
    if (bread.ingredients.length === 0) continue;
    const withBakers = withBakersPercents({ ingredients: bread.ingredients });
    out.push({
      breadTypeId: bread.breadTypeId,
      name: bread.breadTypeName,
      updatedAt: (updated.get(bread.breadTypeId) ?? new Date(0)).toISOString(),
      hydrationPct: round1(hydrationPct(bread.ingredients.map((i) => ({ kind: i.kind, pct: i.pctOfFinished })))),
      ingredients: withBakers.ingredients.map((i) => ({
        name: i.name,
        kind: i.kind,
        pctOfFinished: Number(i.pctOfFinished.toFixed(4)),
        bakersPct: round1(i.pctOfFlour),
      })),
    });
  }
  return out;
}

// ---- get_ingredient_prices ----

export async function getIngredientPrices(groupId: number) {
  const [rows, book, inUse] = await Promise.all([
    loadPriceRows(groupId),
    loadPriceBook(groupId),
    loadIngredientsInUse(groupId),
  ]);
  const derived = starterPricePerKg(book);
  const prices = rows
    .map((r) => ({ name: r.name, kind: r.kind, pricePerKg: money(Number(r.pricePerKg)) }))
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || byName(a.name, b.name));
  const unpricedInUse = inUse
    .filter((i) => (i.kind === 'starter' ? derived === null : book.pricePerKg[priceKey(i.name, i.kind)] === undefined))
    .map((i) => ({ name: i.name, kind: i.kind, usedBy: i.usedBy }))
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || byName(a.name, b.name));
  return {
    prices,
    starter: {
      flourName: book.starter.flourName,
      hydrationPct: book.starter.hydrationPct,
      wasteFactor: book.starter.wasteFactor,
      derivedPricePerKg: derived === null ? null : money(derived),
    },
    unpricedInUse,
  };
}

// ---- get_loaf_costs ----

export interface LoafCostView {
  breadTypeId: number;
  bread: string;
  breadSizeId: number;
  size: string;
  weightGrams: number;
  /** Ingredient cost of one loaf. With `complete: false` it is only the priced part, never the full cost. */
  cost: string;
  costPerKg: string;
  price: string;
  /** price - cost, and as a percentage of price; null while the cost is incomplete or the price is 0. */
  margin: string | null;
  marginPct: number | null;
  complete: boolean;
  unpriced: { name: string; kind: IngredientKind }[];
}

export async function getLoafCosts(groupId: number): Promise<LoafCostView[]> {
  const [costing, menu, book] = await Promise.all([
    loadBreadsForCosting(groupId),
    listBreads(groupId),
    loadPriceBook(groupId),
  ]);
  const prices = new Map<string, string>();
  for (const bread of menu.breads) for (const s of bread.sizes) prices.set(`${bread.id}:${s.sizeId}`, s.price);

  const out: LoafCostView[] = [];
  for (const bread of costing) {
    if (bread.ingredients.length === 0) continue;
    for (const size of bread.sizes) {
      const price = prices.get(`${bread.breadTypeId}:${size.sizeId}`);
      if (size.weightGrams === null || size.weightGrams <= 0 || price === undefined) continue;
      const cost = costScaledRecipe(scaleRecipe({ ingredients: bread.ingredients }, size.weightGrams), book);
      const margin = cost.complete ? Number(price) - cost.total : null;
      out.push({
        breadTypeId: bread.breadTypeId,
        bread: bread.breadTypeName,
        breadSizeId: size.sizeId,
        size: size.sizeName,
        weightGrams: size.weightGrams,
        cost: money(cost.total),
        costPerKg: money(cost.perKg),
        price,
        margin: margin === null ? null : money(margin),
        marginPct: margin === null || Number(price) <= 0 ? null : round1((margin / Number(price)) * 100),
        complete: cost.complete,
        unpriced: cost.unpriced,
      });
    }
  }
  return out;
}

// ---- get_sales ----

export async function getSales(groupId: number, year?: number) {
  const current = israelToday().year;
  const y = year ?? current;
  if (!Number.isInteger(y) || y < 2020 || y > current) {
    throw new ToolInputError(`year must be a whole year from 2020 to ${current}`);
  }
  const report = await buildIncomeReport(groupId, y);
  return {
    year: y,
    breads: report.breads.map((b) => ({
      breadTypeId: b.breadTypeId,
      bread: b.breadTypeName,
      breadSizeId: b.breadSizeId,
      size: b.sizeName,
      unitsByMonth: b.byMonth,
      total: b.total,
    })),
    months: report.months.map((m) => ({
      month: m.month,
      orders: m.orders,
      units: m.units,
      billed: money(m.billed / 100),
    })),
  };
}
