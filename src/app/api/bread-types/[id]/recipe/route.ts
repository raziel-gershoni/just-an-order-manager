import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadRecipes, breadRecipeIngredients } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import { withBakersPercents, type Recipe } from '@/lib/recipe';
import { loadHydrationSplits } from '@/lib/ingredient-costs';
import { recipeInputSchema, validateRecipe, saveRecipe } from '@/lib/catalog-writes';

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
  // Hydration of each home-made row only (no money), so a baker's editor can
  // show total hydration without the owner-only price book.
  const hydrationSplits = await loadHydrationSplits(authResult.groupId);

  return jsonResponse({
    recipe: {
      ingredients: recipe.ingredients,
      bakersPercents: bakers.ingredients,
      hydrationSplits,
      updatedAt: recipeRow.updatedAt,
    },
  });
});

export const PUT = withAuth(async (request, auth) => {
  const breadTypeId = getBreadTypeId(request.url);
  const authResult = await authorize(breadTypeId, auth, { allowBaker: true });
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const parsed = recipeInputSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const checked = validateRecipe(parsed.data);
  if (!checked.ok) return errorResponse(checked.error, 400);

  const saved = await saveRecipe(authResult.groupId, breadTypeId, checked.recipe);
  if (!saved.ok) return errorResponse(saved.error, saved.status);

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
