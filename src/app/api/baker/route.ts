import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import {
  orders,
  orderItems,
  breadTypes,
  breadSizes,
  breadRecipes,
  breadRecipeIngredients,
} from '@/db/schema';
import { eq, and, ne, inArray, asc } from 'drizzle-orm';
import { format } from 'date-fns';
import {
  scaleRecipeByQty,
  sumScaledByType,
  type Recipe,
  type ScaledRecipe,
} from '@/lib/recipe';

export const GET = withGroup(async (request, _auth, groupId) => {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  const date = dateParam || format(new Date(), 'yyyy-MM-dd');

  // Validate date format YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse('Invalid date format, expected YYYY-MM-DD', 400);
  }

  // Pull all non-cancelled orders for this group on this date
  const todayOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.groupId, groupId),
        eq(orders.deliveryDate, date),
        ne(orders.status, 'cancelled')
      )
    );

  if (todayOrders.length === 0) {
    return jsonResponse({ date, byType: [], unconfigured: [] });
  }

  const orderIds = todayOrders.map((o) => o.id);

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

  if (items.length === 0) {
    return jsonResponse({ date, byType: [], unconfigured: [] });
  }

  // Group items by bread type
  type GroupedItem = {
    breadTypeId: number;
    breadTypeName: string;
    bySize: Map<
      number | null,
      {
        sizeId: number | null;
        sizeName: string | null;
        weightGrams: number | null;
        qty: number;
      }
    >;
  };
  const grouped = new Map<number, GroupedItem>();
  for (const it of items) {
    if (!grouped.has(it.breadTypeId)) {
      grouped.set(it.breadTypeId, {
        breadTypeId: it.breadTypeId,
        breadTypeName: it.breadTypeName,
        bySize: new Map(),
      });
    }
    const g = grouped.get(it.breadTypeId)!;
    const key = it.breadSizeId;
    if (!g.bySize.has(key)) {
      g.bySize.set(key, {
        sizeId: it.breadSizeId,
        sizeName: it.sizeName,
        weightGrams: it.sizeWeightGrams,
        qty: 0,
      });
    }
    g.bySize.get(key)!.qty += it.quantity;
  }

  // Pull recipes for all involved bread types
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
  for (const r of recipeRows) {
    recipeByType.set(r.breadTypeId, { ingredients: [] });
  }
  for (const i of ingredientRows) {
    const recipe = recipeByType.get(i.breadTypeId);
    if (!recipe) continue;
    recipe.ingredients.push({
      name: i.name,
      kind: i.kind,
      pctOfFinished: Number(i.pctOfFinished),
      sortOrder: i.sortOrder,
    });
  }

  const byType: {
    breadTypeId: number;
    name: string;
    totalLoaves: number;
    totalFinishedGrams: number;
    hasRecipe: boolean;
    recipe: ScaledRecipe | null;
    bySize: {
      sizeId: number | null;
      sizeName: string | null;
      qty: number;
      finishedGrams: number | null;
      scaled: ScaledRecipe | null;
    }[];
  }[] = [];

  const unconfigured: { breadTypeId: number; name: string; reason: 'no_recipe' | 'size_missing_weight' }[] = [];

  for (const g of grouped.values()) {
    const recipe = recipeByType.get(g.breadTypeId) ?? null;
    const bySizeArr = Array.from(g.bySize.values()).sort(
      (a, b) => (a.weightGrams ?? 0) - (b.weightGrams ?? 0)
    );
    const totalLoaves = bySizeArr.reduce((s, x) => s + x.qty, 0);
    const totalFinishedGrams = bySizeArr.reduce(
      (s, x) => s + (x.weightGrams != null ? x.weightGrams * x.qty : 0),
      0
    );

    let aggregated: ScaledRecipe | null = null;
    let anySizeMissingWeight = false;
    const bySizeOut: typeof byType[number]['bySize'] = [];
    if (recipe && recipe.ingredients.length > 0) {
      const partials: ScaledRecipe[] = [];
      for (const s of bySizeArr) {
        if (s.weightGrams == null) {
          anySizeMissingWeight = true;
          bySizeOut.push({
            sizeId: s.sizeId,
            sizeName: s.sizeName,
            qty: s.qty,
            finishedGrams: null,
            scaled: null,
          });
        } else {
          const scaled = scaleRecipeByQty(recipe, s.weightGrams, s.qty);
          partials.push(scaled);
          bySizeOut.push({
            sizeId: s.sizeId,
            sizeName: s.sizeName,
            qty: s.qty,
            finishedGrams: s.weightGrams * s.qty,
            scaled,
          });
        }
      }
      aggregated = sumScaledByType(partials);
    } else {
      // no recipe — still include sizes for display purposes
      for (const s of bySizeArr) {
        bySizeOut.push({
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
      hasRecipe: !!recipe && recipe.ingredients.length > 0,
      recipe: aggregated,
      bySize: bySizeOut,
    });

    if (!recipe || recipe.ingredients.length === 0) {
      unconfigured.push({ breadTypeId: g.breadTypeId, name: g.breadTypeName, reason: 'no_recipe' });
    } else if (anySizeMissingWeight) {
      unconfigured.push({
        breadTypeId: g.breadTypeId,
        name: g.breadTypeName,
        reason: 'size_missing_weight',
      });
    }
  }

  return jsonResponse({ date, byType, unconfigured });
});
