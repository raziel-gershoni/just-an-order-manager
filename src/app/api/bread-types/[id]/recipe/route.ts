import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadRecipes, breadRecipeIngredients } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import { z } from 'zod/v4';
import { recipeFromGrams, withBakersPercents, type Recipe } from '@/lib/recipe';

function getBreadTypeId(url: string): number {
  // /api/bread-types/[id]/recipe → take the second-to-last path segment
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  return Number(parts[parts.length - 2]);
}

async function authorize(
  breadTypeId: number,
  auth: { memberships: { groupId: number; role: string }[] }
): Promise<{ groupId: number } | Response> {
  const [row] = await db.select().from(breadTypes).where(eq(breadTypes.id, breadTypeId)).limit(1);
  if (!row) return errorResponse('Bread type not found', 404);

  const membership = auth.memberships.find((m) => m.groupId === row.groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if (membership.role === 'baker') {
    return errorResponse('Bakers cannot manage recipes', 403);
  }
  return { groupId: row.groupId };
}

export const GET = withAuth(async (request, auth) => {
  const breadTypeId = getBreadTypeId(request.url);
  const authResult = await authorize(breadTypeId, auth);
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
      z.object({
        name: z.string().min(1).max(100),
        kind: ingredientKindSchema,
        grams: z.number().positive(),
        sortOrder: z.number().int().nonnegative().default(0),
      })
    )
    .min(1),
});

export const PUT = withAuth(async (request, auth) => {
  const breadTypeId = getBreadTypeId(request.url);
  const authResult = await authorize(breadTypeId, auth);
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const { referenceFinishedGrams, ingredients } = parsed.data;

  // At least one flour
  const hasFlour = ingredients.some((i) => i.kind === 'flour');
  if (!hasFlour) {
    return errorResponse('Recipe must include at least one flour ingredient', 400);
  }

  // Sanity: dough total must be ≥ finished weight
  const totalGrams = ingredients.reduce((sum, i) => sum + i.grams, 0);
  if (totalGrams < referenceFinishedGrams) {
    return errorResponse(
      `Total ingredient weight (${totalGrams}g) is less than finished loaf weight (${referenceFinishedGrams}g) — bread can't bake heavier than its dough`,
      400
    );
  }

  const recipe = recipeFromGrams(referenceFinishedGrams, ingredients);

  // Upsert: clear ingredients, upsert recipe row, insert ingredients
  await db.delete(breadRecipeIngredients).where(eq(breadRecipeIngredients.breadTypeId, breadTypeId));

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

  if (recipe.ingredients.length > 0) {
    await db.insert(breadRecipeIngredients).values(
      recipe.ingredients.map((i) => ({
        breadTypeId,
        name: i.name,
        kind: i.kind,
        pctOfFinished: i.pctOfFinished.toFixed(4),
        sortOrder: i.sortOrder,
      }))
    );
  }

  return jsonResponse({ ok: true });
});

export const DELETE = withAuth(async (request, auth) => {
  const breadTypeId = getBreadTypeId(request.url);
  const authResult = await authorize(breadTypeId, auth);
  if (authResult instanceof Response) return authResult;

  await db.delete(breadRecipeIngredients).where(eq(breadRecipeIngredients.breadTypeId, breadTypeId));
  await db.delete(breadRecipes).where(eq(breadRecipes.breadTypeId, breadTypeId));

  return jsonResponse({ deleted: true });
});
