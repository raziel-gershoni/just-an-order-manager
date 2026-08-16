import { db } from '@/db';
import { orderItems, breadTypes, breadSizes, breadRecipes, breadRecipeIngredients } from '@/db/schema';
import { eq, inArray, asc } from 'drizzle-orm';
import {
  scaleRecipeByQty,
  sumScaledByType,
  formatRecipeBlockHebrew,
  type Recipe,
  type ScaledRecipe,
} from './recipe';

/**
 * Scaling the day's orders into actual weights — the one implementation.
 *
 * Three surfaces ask this same question: the baker screen, the Telegram morning
 * summary (and the bot's /today & /week), and the printed packing sheet. They
 * differ only in how they render it, so `aggregateRecipesForOrders` does the
 * reading and the arithmetic and each caller formats.
 */

export interface RecipeSizeBreakdown {
  sizeId: number | null;
  sizeName: string | null;
  qty: number;
  finishedGrams: number | null;
  scaled: ScaledRecipe | null;
}

export interface RecipeTypeAggregate {
  breadTypeId: number;
  name: string;
  totalLoaves: number;
  totalFinishedGrams: number;
  hasRecipe: boolean;
  recipe: ScaledRecipe | null;
  bySize: RecipeSizeBreakdown[];
}

export interface RecipeAggregate {
  byType: RecipeTypeAggregate[];
  /**
   * Types the sheet can't weigh out, and why. Worth surfacing rather than
   * silently dropping: a recipe block that quietly omits a bread reads as
   * "nothing else to mix".
   */
  unconfigured: {
    breadTypeId: number;
    name: string;
    reason: 'no_recipe' | 'size_missing_weight';
  }[];
}

/** Every bread type across these orders, scaled to the quantities ordered. */
export async function aggregateRecipesForOrders(orderIds: number[]): Promise<RecipeAggregate> {
  if (orderIds.length === 0) return { byType: [], unconfigured: [] };

  const items = await db
    .select({
      breadTypeId: orderItems.breadTypeId,
      breadTypeName: breadTypes.name,
      breadSizeId: orderItems.breadSizeId,
      sizeName: breadSizes.name,
      sizeWeightGrams: breadSizes.weightGrams,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
    .where(inArray(orderItems.orderId, orderIds));

  if (items.length === 0) return { byType: [], unconfigured: [] };

  type Grouped = {
    breadTypeId: number;
    breadTypeName: string;
    bySize: Map<
      number | null,
      { sizeId: number | null; sizeName: string | null; weightGrams: number | null; qty: number }
    >;
  };
  const grouped = new Map<number, Grouped>();
  for (const it of items) {
    if (!grouped.has(it.breadTypeId)) {
      grouped.set(it.breadTypeId, {
        breadTypeId: it.breadTypeId,
        breadTypeName: it.breadTypeName,
        bySize: new Map(),
      });
    }
    const g = grouped.get(it.breadTypeId)!;
    if (!g.bySize.has(it.breadSizeId)) {
      g.bySize.set(it.breadSizeId, {
        sizeId: it.breadSizeId,
        sizeName: it.sizeName,
        weightGrams: it.sizeWeightGrams,
        qty: 0,
      });
    }
    g.bySize.get(it.breadSizeId)!.qty += it.quantity;
  }

  const breadTypeIds = Array.from(grouped.keys());
  const recipeRows = await db
    .select()
    .from(breadRecipes)
    .where(inArray(breadRecipes.breadTypeId, breadTypeIds));
  const ingredientRows = recipeRows.length
    ? await db
        .select()
        .from(breadRecipeIngredients)
        .where(inArray(breadRecipeIngredients.breadTypeId, breadTypeIds))
        .orderBy(asc(breadRecipeIngredients.sortOrder))
    : [];

  const recipeByType = new Map<number, Recipe>();
  for (const r of recipeRows) recipeByType.set(r.breadTypeId, { ingredients: [] });
  for (const i of ingredientRows) {
    recipeByType.get(i.breadTypeId)?.ingredients.push({
      name: i.name,
      kind: i.kind,
      pctOfFinished: Number(i.pctOfFinished),
      sortOrder: i.sortOrder,
    });
  }

  const byType: RecipeTypeAggregate[] = [];
  const unconfigured: RecipeAggregate['unconfigured'] = [];

  for (const g of grouped.values()) {
    const recipe = recipeByType.get(g.breadTypeId) ?? null;
    const sizes = Array.from(g.bySize.values()).sort(
      (a, b) => (a.weightGrams ?? 0) - (b.weightGrams ?? 0)
    );
    const totalLoaves = sizes.reduce((s, x) => s + x.qty, 0);
    const totalFinishedGrams = sizes.reduce(
      (s, x) => s + (x.weightGrams != null ? x.weightGrams * x.qty : 0),
      0
    );

    const hasRecipe = !!recipe && recipe.ingredients.length > 0;
    const bySize: RecipeSizeBreakdown[] = [];
    let aggregated: ScaledRecipe | null = null;
    let anySizeMissingWeight = false;

    if (hasRecipe) {
      const partials: ScaledRecipe[] = [];
      for (const s of sizes) {
        // A size with no weight can't be scaled — there's nothing to multiply
        // the baker's percentages by.
        if (s.weightGrams == null) {
          anySizeMissingWeight = true;
          bySize.push({ sizeId: s.sizeId, sizeName: s.sizeName, qty: s.qty, finishedGrams: null, scaled: null });
          continue;
        }
        const scaled = scaleRecipeByQty(recipe!, s.weightGrams, s.qty);
        partials.push(scaled);
        bySize.push({
          sizeId: s.sizeId,
          sizeName: s.sizeName,
          qty: s.qty,
          finishedGrams: s.weightGrams * s.qty,
          scaled,
        });
      }
      aggregated = sumScaledByType(partials);
    } else {
      for (const s of sizes) {
        bySize.push({
          sizeId: s.sizeId,
          sizeName: s.sizeName,
          qty: s.qty,
          finishedGrams: s.weightGrams != null ? s.weightGrams * s.qty : null,
          scaled: null,
        });
      }
    }

    byType.push({
      breadTypeId: g.breadTypeId,
      name: g.breadTypeName,
      totalLoaves,
      totalFinishedGrams,
      hasRecipe,
      recipe: aggregated,
      bySize,
    });

    if (!hasRecipe) {
      unconfigured.push({ breadTypeId: g.breadTypeId, name: g.breadTypeName, reason: 'no_recipe' });
    } else if (anySizeMissingWeight) {
      unconfigured.push({
        breadTypeId: g.breadTypeId,
        name: g.breadTypeName,
        reason: 'size_missing_weight',
      });
    }
  }

  return { byType, unconfigured };
}

/**
 * The Hebrew recipe block used in the Telegram morning summary and the bot's
 * /today & /week. Types with no recipe are silently skipped; returns '' when
 * nothing on the day can be weighed out.
 */
export async function buildRecipeBlockForOrders(orderIds: number[]): Promise<string> {
  const { byType } = await aggregateRecipesForOrders(orderIds);
  return formatRecipeBlockHebrew(
    byType.map((t) => ({
      name: t.name,
      loaves: t.totalLoaves,
      finishedGrams: t.totalFinishedGrams,
      recipe: t.hasRecipe ? t.recipe : null,
    }))
  );
}
