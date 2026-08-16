import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadRecipes, breadRecipeIngredients } from '@/db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import {
  recipeFromEntries,
  entryGrams,
  withBakersPercents,
  type Recipe,
  type RecipeEntry,
} from '@/lib/recipe';

function getBreadTypeId(url: string): number {
  // /api/bread-types/[id]/recipe → take the second-to-last path segment
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  return Number(parts[parts.length - 2]);
}

async function authorize(
  breadTypeId: number,
  auth: { memberships: { groupId: number; role: string }[] },
  opts: { allowBaker: boolean }
): Promise<{ groupId: number } | Response> {
  const [row] = await db.select().from(breadTypes).where(eq(breadTypes.id, breadTypeId)).limit(1);
  if (!row) return errorResponse('Bread type not found', 404);

  const membership = auth.memberships.find((m) => m.groupId === row.groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if (!opts.allowBaker && (membership.role === 'baker' || membership.role === 'driver')) {
    return errorResponse('Only managers can delete recipes', 403);
  }
  return { groupId: row.groupId };
}

export const GET = withAuth(async (request, auth) => {
  const breadTypeId = getBreadTypeId(request.url);
  const authResult = await authorize(breadTypeId, auth, { allowBaker: true });
  if (authResult instanceof Response) return authResult;

  const [recipeRow] = await db
    .select()
    .from(breadRecipes)
    .where(eq(breadRecipes.breadTypeId, breadTypeId))
    .limit(1);

  if (!recipeRow) {
    return jsonResponse({ recipe: null });
  }

  const ingredients = await db
    .select()
    .from(breadRecipeIngredients)
    .where(eq(breadRecipeIngredients.breadTypeId, breadTypeId))
    .orderBy(asc(breadRecipeIngredients.sortOrder));

  const recipe: Recipe = {
    ingredients: ingredients.map((i) => ({
      name: i.name,
      kind: i.kind,
      pctOfFinished: Number(i.pctOfFinished),
      sortOrder: i.sortOrder,
    })),
  };

  const bakers = withBakersPercents(recipe);

  return jsonResponse({
    recipe: {
      ingredients: recipe.ingredients,
      bakersPercents: bakers.ingredients,
      updatedAt: recipeRow.updatedAt,
    },
  });
});

const ingredientKindSchema = z.enum(['flour', 'water', 'salt', 'starter', 'other']);

const putSchema = z.object({
  referenceFinishedGrams: z.number().int().positive(),
  ingredients: z
    .array(
      z
        .object({
          name: z.string().min(1).max(100),
          kind: ingredientKindSchema,
          sortOrder: z.number().int().nonnegative().default(0),
          grams: z.number().positive().optional(),
          pctOfFinished: z.number().positive().optional(),
        })
        // Exactly one: a row is either something the baker typed in grams, or a
        // percentage carried over untouched. Accepting both would leave the
        // server picking which one is the truth.
        .refine((r) => (r.grams === undefined) !== (r.pctOfFinished === undefined), {
          message: 'Each ingredient needs exactly one of grams or pctOfFinished',
        })
    )
    .min(1),
});

export const PUT = withAuth(async (request, auth) => {
  const breadTypeId = getBreadTypeId(request.url);
  const authResult = await authorize(breadTypeId, auth, { allowBaker: true });
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const { referenceFinishedGrams } = parsed.data;
  const entries = parsed.data.ingredients as RecipeEntry[];

  // At least one flour
  const hasFlour = entries.some((i) => i.kind === 'flour');
  if (!hasFlour) {
    return errorResponse('Recipe must include at least one flour ingredient', 400);
  }

  // Two rows with the same name silently merge in sumScaledByType, which keys
  // on name|kind — so the daily aggregate would quietly under-report.
  const names = entries.map((i) => i.name.trim());
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) {
    return errorResponse(`Ingredient "${duplicate}" appears twice`, 400);
  }

  // Percentage rows have to be resolved to grams before this comparison, or a
  // mixed payload would weigh a partial sum against the whole loaf.
  const totalGrams = entries.reduce((sum, i) => sum + entryGrams(referenceFinishedGrams, i), 0);
  if (totalGrams < referenceFinishedGrams) {
    return errorResponse(
      `Total ingredient weight (${Math.round(totalGrams)}g) is less than finished loaf weight (${referenceFinishedGrams}g) — bread can't bake heavier than its dough`,
      400
    );
  }

  const recipe = recipeFromEntries(referenceFinishedGrams, entries);

  // The parent row first: it carries no ingredient data and is idempotent, and
  // "recipe row with no ingredients" is a state we already tolerate before the
  // first save.
  const [existing] = await db
    .select()
    .from(breadRecipes)
    .where(eq(breadRecipes.breadTypeId, breadTypeId))
    .limit(1);

  if (existing) {
    await db
      .update(breadRecipes)
      .set({ updatedAt: new Date() })
      .where(eq(breadRecipes.breadTypeId, breadTypeId));
  } else {
    await db.insert(breadRecipes).values({ breadTypeId });
  }

  // Delete + insert as ONE statement. neon-http has no interactive
  // transactions, so a two-statement swap can strand a bread that looks
  // configured with zero ingredients — which every read surface renders as
  // "no recipe", silently.
  const values = recipe.ingredients.map(
    (i) =>
      sql`(${breadTypeId}, ${i.name.trim()}, ${i.kind}::ingredient_kind, ${i.pctOfFinished.toFixed(4)}, ${i.sortOrder})`
  );
  await db.execute(sql`
    WITH cleared AS (
      DELETE FROM bread_recipe_ingredients WHERE bread_type_id = ${breadTypeId}
    )
    INSERT INTO bread_recipe_ingredients (bread_type_id, name, kind, pct_of_finished, sort_order)
    VALUES ${sql.join(values, sql`, `)}
  `);

  return jsonResponse({ ok: true });
});

export const DELETE = withAuth(async (request, auth) => {
  const breadTypeId = getBreadTypeId(request.url);
  const authResult = await authorize(breadTypeId, auth, { allowBaker: false });
  if (authResult instanceof Response) return authResult;

  await db.delete(breadRecipeIngredients).where(eq(breadRecipeIngredients.breadTypeId, breadTypeId));
  await db.delete(breadRecipes).where(eq(breadRecipes.breadTypeId, breadTypeId));

  return jsonResponse({ deleted: true });
});
