import { withGroup, jsonResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadRecipes, breadRecipeIngredients } from '@/db/schema';
import { eq, and, inArray, asc } from 'drizzle-orm';
import { loadHydrationSplits } from '@/lib/ingredient-costs';
import { totalHydration } from '@/lib/hydration';
import { withBakersPercents, KIND_DISPLAY_ORDER, type IngredientKind } from '@/lib/recipe';

/**
 * Every configured recipe in the group, plus the ingredient names already in
 * use. One call rather than three: the copy flow needs the source list AND the
 * chosen source's rows AND the name suggestions, and at this scale (tens of
 * rows) a second round trip costs more than the rows do.
 *
 * Bakers may read this — they own recipes here, same as the per-type GET.
 */
export const GET = withGroup(async (_request, _auth, groupId) => {
  const types = await db
    .select({ id: breadTypes.id, name: breadTypes.name, sortOrder: breadTypes.sortOrder })
    .from(breadTypes)
    .where(and(eq(breadTypes.groupId, groupId), eq(breadTypes.isActive, true)))
    .orderBy(asc(breadTypes.sortOrder));

  const typeIds = types.map((t) => t.id);
  if (typeIds.length === 0) return jsonResponse({ recipes: [], namesByKind: blankNames() });

  const recipeRows = await db
    .select({ breadTypeId: breadRecipes.breadTypeId })
    .from(breadRecipes)
    .where(inArray(breadRecipes.breadTypeId, typeIds));
  if (recipeRows.length === 0) return jsonResponse({ recipes: [], namesByKind: blankNames() });

  const configured = recipeRows.map((r) => r.breadTypeId);
  const ingredientRows = await db
    .select()
    .from(breadRecipeIngredients)
    .where(inArray(breadRecipeIngredients.breadTypeId, configured))
    .orderBy(asc(breadRecipeIngredients.sortOrder));

  const byType = new Map<number, typeof ingredientRows>();
  for (const row of ingredientRows) {
    const list = byType.get(row.breadTypeId) ?? [];
    list.push(row);
    byType.set(row.breadTypeId, list);
  }

  const splits = await loadHydrationSplits(groupId);

  const namesByKind = blankNames();
  for (const row of ingredientRows) {
    if (!namesByKind[row.kind].includes(row.name)) namesByKind[row.kind].push(row.name);
  }
  for (const kind of KIND_DISPLAY_ORDER) {
    namesByKind[kind].sort((a, b) => a.localeCompare(b, 'he'));
  }

  const recipes = types
    .filter((t) => (byType.get(t.id)?.length ?? 0) > 0)
    .map((t) => {
      const rows = byType.get(t.id)!;
      const bakers = withBakersPercents({
        ingredients: rows.map((r) => ({
          name: r.name,
          kind: r.kind,
          pctOfFinished: Number(r.pctOfFinished),
          sortOrder: r.sortOrder,
        })),
      });
      const hydration = totalHydration(
        rows.map((r) => ({ name: r.name, kind: r.kind, pct: Number(r.pctOfFinished) })),
        splits
      );
      return {
        breadTypeId: t.id,
        breadTypeName: t.name,
        // Total hydration (counts the flour and liquid inside home-made
        // ingredients): the number a baker recognises a dough by. Null when
        // there is no liquid or no flour to compare.
        hydrationPct: hydration.pct !== null ? Math.round(hydration.pct) : null,
        hydrationLeavesOut: hydration.leavesOut,
        ingredients: bakers.ingredients.map((i) => ({
          name: i.name,
          kind: i.kind,
          pctOfFinished: i.pctOfFinished,
          pctOfFlour: i.pctOfFlour,
          sortOrder: i.sortOrder,
        })),
      };
    });

  return jsonResponse({ recipes, namesByKind });
});

function blankNames(): Record<IngredientKind, string[]> {
  return { flour: [], water: [], salt: [], starter: [], other: [] };
}
