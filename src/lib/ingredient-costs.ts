import { db } from '@/db';
import {
  groups,
  breadTypes,
  breadSizes,
  breadTypeSizes,
  breadRecipes,
  breadRecipeIngredients,
  ingredientPrices,
} from '@/db/schema';
import { eq, and, inArray, asc } from 'drizzle-orm';
import { scaleRecipe, type IngredientKind, type Recipe } from './recipe';
import { costScaledRecipe, priceKey, type PriceBook } from './cost';

/**
 * Reading the ingredient price book and turning it into per-loaf costs.
 *
 * Shaped like loadGroupTiers in order-pricing.ts: a thin DB wrapper feeding a
 * pure engine (src/lib/cost.ts), so the route stays auth → load → delegate.
 */

export interface InUseIngredient {
  name: string;
  kind: IngredientKind;
  /** Bread types whose recipe contains it — the owner's answer to "what is this for?". */
  usedBy: string[];
}

export interface LoafCostRow {
  sizeId: number;
  sizeName: string;
  weightGrams: number;
  total: number;
  perKg: number;
  unpriced: { name: string; kind: IngredientKind }[];
}

export interface BreadCost {
  breadTypeId: number;
  breadTypeName: string;
  isActive: boolean;
  hasRecipe: boolean;
  sizes: LoafCostRow[];
  /** Enabled sizes with no weight — a recipe cannot scale to them (e.g. בינוני). */
  sizesMissingWeight: string[];
}

/** A saved price exactly as the editor round-trips it — decimal string, not float. */
export interface PriceRow {
  name: string;
  kind: IngredientKind;
  pricePerKg: string;
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
      sortOrder: breadRecipeIngredients.sortOrder,
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

/**
 * Cost per loaf for every bread × enabled size that can be computed, and an
 * explicit reason for each one that can't. Computed server-side so the costs
 * screen is one fetch and no recipe row ever reaches the client.
 */
export async function loadLoafCosts(groupId: number, book: PriceBook): Promise<BreadCost[]> {
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
      .innerJoin(breadRecipes, eq(breadRecipes.breadTypeId, breadRecipeIngredients.breadTypeId))
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

  const recipeByType = new Map<number, Recipe>();
  for (const row of ingredientRows) {
    const recipe = recipeByType.get(row.breadTypeId) ?? { ingredients: [] };
    recipe.ingredients.push({
      name: row.name,
      kind: row.kind,
      pctOfFinished: Number(row.pctOfFinished),
      sortOrder: row.sortOrder,
    });
    recipeByType.set(row.breadTypeId, recipe);
  }

  return types.map((type) => {
    const recipe = recipeByType.get(type.id) ?? null;
    const sizes = sizeRows.filter((s) => s.breadTypeId === type.id);

    return {
      breadTypeId: type.id,
      breadTypeName: type.name,
      isActive: type.isActive,
      hasRecipe: recipe !== null,
      sizesMissingWeight: sizes.filter((s) => s.weightGrams == null).map((s) => s.sizeName),
      sizes: recipe
        ? sizes
            .filter((s): s is typeof s & { weightGrams: number } => s.weightGrams != null)
            .map((s) => {
              const cost = costScaledRecipe(scaleRecipe(recipe, s.weightGrams), book);
              return {
                sizeId: s.sizeId,
                sizeName: s.sizeName,
                weightGrams: s.weightGrams,
                total: cost.total,
                perKg: cost.perKg,
                unpriced: cost.unpriced,
              };
            })
        : [],
    };
  });
}
