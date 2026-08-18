import { db } from '@/db';
import {
  groups,
  breadTypes,
  breadSizes,
  breadTypeSizes,
  breadRecipeIngredients,
  ingredientPrices,
} from '@/db/schema';
import { eq, and, inArray, asc } from 'drizzle-orm';
import type { IngredientKind } from './recipe';
import { priceKey, type PriceBook } from './cost';

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

export async function loadPriceBook(groupId: number): Promise<PriceBook> {
  const [rows, [group]] = await Promise.all([
    loadPriceRows(groupId),
    db
      .select({
        flourName: groups.starterFlourName,
        hydrationPct: groups.starterHydrationPct,
        wasteFactor: groups.starterWasteFactor,
      })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1),
  ]);

  const pricePerKg: Record<string, number> = {};
  for (const row of rows) {
    pricePerKg[priceKey(row.name, row.kind)] = Number(row.pricePerKg);
  }

  return {
    pricePerKg,
    starter: {
      flourName: group?.flourName ?? null,
      hydrationPct: group?.hydrationPct ?? 100,
      wasteFactor: Number(group?.wasteFactor ?? 1.5),
    },
  };
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
    .orderBy(asc(breadRecipeIngredients.sortOrder));

  const byKey = new Map<string, InUseIngredient>();
  for (const row of rows) {
    const key = priceKey(row.name, row.kind);
    const entry = byKey.get(key) ?? { name: row.name, kind: row.kind, usedBy: [] };
    if (!entry.usedBy.includes(row.breadTypeName)) entry.usedBy.push(row.breadTypeName);
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

/** Every bread with its recipe percentages and its enabled sizes' weights. */
export async function loadBreadsForCosting(groupId: number): Promise<BreadForCosting[]> {
  const types = await db
    .select({ id: breadTypes.id, name: breadTypes.name, isActive: breadTypes.isActive })
    .from(breadTypes)
    .where(eq(breadTypes.groupId, groupId))
    .orderBy(asc(breadTypes.sortOrder));
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
      .orderBy(asc(breadRecipeIngredients.sortOrder)),
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
      .orderBy(asc(breadTypeSizes.sortOrder)),
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
