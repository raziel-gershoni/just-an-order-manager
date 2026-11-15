import { db } from '@/db';
import {
  breadTypes,
  breadSizes,
  breadTypeSizes,
  breadSizeTiers,
  breadRecipes,
  ingredientPrices,
} from '@/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { revalidatePublicSite } from '@/lib/public-site';
import {
  recipeFromEntries,
  entryGrams,
  type Recipe,
  type RecipeEntry,
  type IngredientKind,
} from '@/lib/recipe';

/**
 * The catalogue writes that both the mini-app routes and an approved MCP
 * proposal perform. One copy of each, so a rule added here holds on both paths.
 * Every function takes the groupId and scopes by it itself: a caller that
 * checked membership still cannot reach another bakery's rows by passing a
 * foreign id.
 */

export type WriteResult = { ok: true } | { ok: false; status: 400 | 404; error: string };

// ---- Recipe ----

const ingredientKindSchema = z.enum(['flour', 'water', 'salt', 'starter', 'other']);

export const recipeInputSchema = z.object({
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
export type RecipeInput = z.infer<typeof recipeInputSchema>;

/** The recipe rules, pure: nothing here touches the database. */
export function validateRecipe(
  input: RecipeInput
): { ok: true; recipe: Recipe } | { ok: false; error: string } {
  const { referenceFinishedGrams } = input;
  const entries = input.ingredients as RecipeEntry[];

  // At least one flour
  if (!entries.some((i) => i.kind === 'flour')) {
    return { ok: false, error: 'Recipe must include at least one flour ingredient' };
  }

  // Two rows with the same name silently merge in sumScaledByType, which keys
  // on name|kind — so the daily aggregate would quietly under-report.
  const names = entries.map((i) => i.name.trim());
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) {
    return { ok: false, error: `Ingredient "${duplicate}" appears twice` };
  }

  // Percentage rows have to be resolved to grams before this comparison, or a
  // mixed payload would weigh a partial sum against the whole loaf.
  const totalGrams = entries.reduce((sum, i) => sum + entryGrams(referenceFinishedGrams, i), 0);
  if (totalGrams < referenceFinishedGrams) {
    return {
      ok: false,
      error: `Total ingredient weight (${Math.round(totalGrams)}g) is less than finished loaf weight (${referenceFinishedGrams}g) — bread can't bake heavier than its dough`,
    };
  }

  return { ok: true, recipe: recipeFromEntries(referenceFinishedGrams, entries) };
}

export async function saveRecipe(
  groupId: number,
  breadTypeId: number,
  recipe: Recipe
): Promise<WriteResult> {
  const [owned] = await db
    .select({ id: breadTypes.id })
    .from(breadTypes)
    .where(and(eq(breadTypes.id, breadTypeId), eq(breadTypes.groupId, groupId)))
    .limit(1);
  if (!owned) return { ok: false, status: 404, error: 'Bread type not found' };

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

  return { ok: true };
}

// ---- Prices ----

/** A bread size's default price (`bread_sizes.price`). */
export async function setSizePrice(
  groupId: number,
  breadSizeId: number,
  price: string
): Promise<WriteResult> {
  const updated = await db
    .update(breadSizes)
    .set({ price })
    .where(and(eq(breadSizes.id, breadSizeId), eq(breadSizes.groupId, groupId)))
    .returning({ id: breadSizes.id });
  if (updated.length === 0) return { ok: false, status: 404, error: 'Bread size not found' };

  // Price edits flow to the public pricelist — purge its cache.
  revalidatePublicSite(groupId);
  return { ok: true };
}

/**
 * One bread's price for one size (`bread_type_sizes.price_override`), or null to
 * remove the override. Only updates an existing link, never adds one: whether a
 * bread offers a size is not a price decision.
 */
export async function setBreadSizePriceOverride(
  groupId: number,
  breadTypeId: number,
  breadSizeId: number,
  price: string | null
): Promise<WriteResult> {
  const updated = await db
    .update(breadTypeSizes)
    .set({ priceOverride: price })
    .where(
      and(
        eq(breadTypeSizes.breadTypeId, breadTypeId),
        eq(breadTypeSizes.breadSizeId, breadSizeId),
        inArray(
          breadTypeSizes.breadTypeId,
          db.select({ id: breadTypes.id }).from(breadTypes).where(eq(breadTypes.groupId, groupId))
        ),
        inArray(
          breadTypeSizes.breadSizeId,
          db.select({ id: breadSizes.id }).from(breadSizes).where(eq(breadSizes.groupId, groupId))
        )
      )
    )
    .returning({ id: breadTypeSizes.breadTypeId });
  if (updated.length === 0) return { ok: false, status: 404, error: 'Bread size link not found' };

  revalidatePublicSite(groupId);
  return { ok: true };
}

// ---- Bulk tiers ----

export async function upsertTier(
  groupId: number,
  t: { breadSizeId: number; breadTypeId: number | null; minQty: number; price: string }
): Promise<
  | { ok: true; tier: typeof breadSizeTiers.$inferSelect }
  | { ok: false; status: 404; error: string }
> {
  const { breadSizeId, breadTypeId, minQty, price } = t;

  const [size] = await db
    .select({ id: breadSizes.id })
    .from(breadSizes)
    .where(and(eq(breadSizes.id, breadSizeId), eq(breadSizes.groupId, groupId)))
    .limit(1);
  if (!size) return { ok: false, status: 404, error: 'Size not found' };

  if (breadTypeId != null) {
    const [type] = await db
      .select({ id: breadTypes.id })
      .from(breadTypes)
      .where(and(eq(breadTypes.id, breadTypeId), eq(breadTypes.groupId, groupId)))
      .limit(1);
    if (!type) return { ok: false, status: 404, error: 'Type not found' };
  }

  // Idempotent upsert: clear any existing row for this exact tuple, then insert.
  // Handles the null-breadTypeId "default" case, which a unique index can't
  // dedupe because SQL treats NULLs as distinct.
  const typeCond =
    breadTypeId == null
      ? sql`${breadSizeTiers.breadTypeId} IS NULL`
      : eq(breadSizeTiers.breadTypeId, breadTypeId);
  await db
    .delete(breadSizeTiers)
    .where(
      and(
        eq(breadSizeTiers.groupId, groupId),
        eq(breadSizeTiers.breadSizeId, breadSizeId),
        typeCond,
        eq(breadSizeTiers.minQty, minQty)
      )
    );
  const [row] = await db
    .insert(breadSizeTiers)
    .values({ groupId, breadSizeId, breadTypeId, minQty, price })
    .returning();

  // Tiers drive the public "deals" — purge the cached pricelist.
  revalidatePublicSite(groupId);
  return { ok: true, tier: row };
}

export async function deleteTier(
  groupId: number,
  ref: { id: number } | { breadSizeId: number; breadTypeId: number | null; minQty: number }
): Promise<WriteResult> {
  if ('id' in ref) {
    // The route's long-standing behaviour: deleting a tier that is already gone
    // is not an error.
    await db
      .delete(breadSizeTiers)
      .where(and(eq(breadSizeTiers.id, ref.id), eq(breadSizeTiers.groupId, groupId)));
    revalidatePublicSite(groupId);
    return { ok: true };
  }

  const typeCond =
    ref.breadTypeId == null
      ? sql`${breadSizeTiers.breadTypeId} IS NULL`
      : eq(breadSizeTiers.breadTypeId, ref.breadTypeId);
  const deleted = await db
    .delete(breadSizeTiers)
    .where(
      and(
        eq(breadSizeTiers.groupId, groupId),
        eq(breadSizeTiers.breadSizeId, ref.breadSizeId),
        typeCond,
        eq(breadSizeTiers.minQty, ref.minQty)
      )
    )
    .returning({ id: breadSizeTiers.id });
  if (deleted.length === 0) return { ok: false, status: 404, error: 'Tier not found' };

  revalidatePublicSite(groupId);
  return { ok: true };
}

// ---- Ingredient prices ----

/**
 * One ingredient's price per kilo. A single upsert: unlike the price-book save
 * it prunes nothing, so a proposal for one ingredient cannot drop the others.
 * The starter's price is derived from the starter settings, never stored here.
 */
export async function upsertIngredientPrice(
  groupId: number,
  p: { name: string; kind: IngredientKind; pricePerKg: string }
): Promise<WriteResult> {
  if (p.kind === 'starter') {
    return { ok: false, status: 400, error: 'The starter price is derived from the starter settings' };
  }
  await db
    .insert(ingredientPrices)
    .values({ groupId, name: p.name.trim(), kind: p.kind, pricePerKg: p.pricePerKg })
    .onConflictDoUpdate({
      target: [ingredientPrices.groupId, ingredientPrices.name, ingredientPrices.kind],
      set: { pricePerKg: p.pricePerKg, updatedAt: sql`now()` },
    });
  return { ok: true };
}
