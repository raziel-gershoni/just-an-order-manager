import { db } from '@/db';
import { orderItems, breadTypes, breadSizes, breadRecipes, breadRecipeIngredients } from '@/db/schema';
import { eq, inArray, asc } from 'drizzle-orm';
import { scaleRecipeByQty, sumScaledByType, formatRecipeBlockHebrew, type Recipe, type ScaledRecipe } from './recipe';

/**
 * Build the Hebrew baker recipe block aggregating every line item across the
 * given orders — the one implementation, shared by the bot's /today & /week and
 * the morning-reminder cron (both had a verbatim copy). Returns '' when no
 * involved bread type has a recipe configured.
 */
export async function buildRecipeBlockForOrders(orderIds: number[]): Promise<string> {
  if (orderIds.length === 0) return '';

  const items = await db
    .select({
      breadTypeId: orderItems.breadTypeId,
      breadTypeName: breadTypes.name,
      weightGrams: breadSizes.weightGrams,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
    .where(inArray(orderItems.orderId, orderIds));

  if (items.length === 0) return '';

  type Agg = { name: string; loaves: number; finishedGrams: number; partials: ScaledRecipe[] };
  const aggByType = new Map<number, Agg>();
  for (const it of items) {
    if (!aggByType.has(it.breadTypeId)) {
      aggByType.set(it.breadTypeId, { name: it.breadTypeName, loaves: 0, finishedGrams: 0, partials: [] });
    }
  }

  const involvedTypeIds = Array.from(aggByType.keys());
  const recipeRows = await db
    .select()
    .from(breadRecipes)
    .where(inArray(breadRecipes.breadTypeId, involvedTypeIds));
  const ingRows = recipeRows.length
    ? await db
        .select()
        .from(breadRecipeIngredients)
        .where(inArray(breadRecipeIngredients.breadTypeId, involvedTypeIds))
        .orderBy(asc(breadRecipeIngredients.sortOrder))
    : [];
  const recipeByType = new Map<number, Recipe>();
  for (const r of recipeRows) recipeByType.set(r.breadTypeId, { ingredients: [] });
  for (const i of ingRows) {
    recipeByType.get(i.breadTypeId)?.ingredients.push({
      name: i.name,
      kind: i.kind,
      pctOfFinished: Number(i.pctOfFinished),
      sortOrder: i.sortOrder,
    });
  }

  for (const it of items) {
    const agg = aggByType.get(it.breadTypeId)!;
    agg.loaves += it.quantity;
    if (it.weightGrams != null) agg.finishedGrams += it.weightGrams * it.quantity;
    const recipe = recipeByType.get(it.breadTypeId);
    if (recipe && recipe.ingredients.length > 0 && it.weightGrams != null) {
      agg.partials.push(scaleRecipeByQty(recipe, it.weightGrams, it.quantity));
    }
  }

  const entries = Array.from(aggByType.values()).map((a) => ({
    name: a.name,
    loaves: a.loaves,
    finishedGrams: a.finishedGrams,
    recipe: a.partials.length > 0 ? sumScaledByType(a.partials) : null,
  }));
  return formatRecipeBlockHebrew(entries);
}
