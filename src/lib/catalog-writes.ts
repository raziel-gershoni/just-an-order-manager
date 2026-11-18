import { db } from '@/db';
import {
  breadTypes,
  breadSizes,
  breadTypeSizes,
  breadSizeTiers,
  breadRecipes,
  ingredientPrices,
  homeMadeIngredients,
} from '@/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { priceKey, type HomeMadeSettings } from '@/lib/cost';
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

/** One home-made ingredient's settings (starter, tangzhong). */
export const homeMadeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['starter', 'other']),
  flourName: z.string().trim().min(1).max(100).nullable(),
  liquidName: z.string().trim().min(1).max(100),
  liquidKind: z.enum(['water', 'other']),
  hydrationPct: z.number().int().min(1).max(1000),
  wasteFactor: z.number().min(1).max(10),
});

type PriceInput = { name: string; kind: IngredientKind; pricePerKg: string };

/**
 * The rules for a prices body, pure: no typed starter price (it is derived) and
 * no key twice. Readable messages, because the unique index would answer with a
 * Postgres error. That a key is not home-made needs the database; see
 * saveIngredientBook.
 */
export function validateIngredientBook(prices: PriceInput[]): { ok: true } | { ok: false; error: string } {
  const nameOf = (key: string) => key.slice(0, key.lastIndexOf('|'));
  const priceKeys = prices.map((p) => priceKey(p.name, p.kind));

  if (prices.some((p) => p.kind === 'starter')) {
    return { ok: false, error: 'The starter price is derived from the starter settings' };
  }
  const dupPrice = priceKeys.find((k, i) => priceKeys.indexOf(k) !== i);
  if (dupPrice) return { ok: false, error: `Ingredient "${nameOf(dupPrice)}" appears twice` };
  return { ok: true };
}

/**
 * Names go onto plain-text cards: a line break in one could fake a line of the
 * card. Format characters (\p{Cf}) include the bidi overrides and isolates: one
 * at the end of a name would reorder the rest of its card line.
 */
export const hasControlChars = (s: string) => /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(s);

/**
 * The settings rules both the catalogue editor and an MCP proposal enforce:
 * names present and clean, and a liquid that is neither the entry itself nor
 * another home-made ingredient. An English message, or null when fine. A null
 * flour is allowed (not set up yet); a blank one is not.
 */
export async function checkHomeMade(groupId: number, s: HomeMadeSettings): Promise<string | null> {
  const name = s.name.trim();
  const flourName = s.flourName === null ? null : s.flourName.trim();
  const liquidName = s.liquidName.trim();
  if (name === '' || flourName === '' || liquidName === '') return 'Names cannot be blank';
  if ([name, flourName ?? '', liquidName].some(hasControlChars)) {
    return 'Names cannot contain line breaks or control characters';
  }
  if (s.liquidKind !== 'other') return null;
  if (liquidName === name) return 'A home-made ingredient cannot be its own liquid';
  // A liquid of kind "starter" cannot be expressed (liquidKind is water|other),
  // so a starter's name given as an "other" liquid is refused by name.
  const rows = await db
    .select({ kind: homeMadeIngredients.kind })
    .from(homeMadeIngredients)
    .where(
      and(
        eq(homeMadeIngredients.groupId, groupId),
        eq(homeMadeIngredients.name, liquidName),
        inArray(homeMadeIngredients.kind, ['starter', 'other'])
      )
    );
  if (rows.some((r) => r.kind === 'starter')) {
    return `${liquidName} is a starter: a home-made ingredient cannot be made from another home-made ingredient`;
  }
  if (rows.some((r) => r.kind === 'other')) {
    return `${liquidName} is home-made: a home-made ingredient cannot be made from another home-made ingredient`;
  }
  return null;
}

/**
 * Replace the group's whole price book in ONE statement (neon-http has no
 * interactive transactions, so a two-statement swap can strand a half-saved
 * book). Prices only: it never touches home_made_ingredients.
 *
 * A typed price for a key that has a home-made row is refused (400). The check
 * is in the same statement, so a home-made row saved a moment earlier cannot
 * slip past a read that went before: when any such key is in the body, the
 * upsert and the prune do nothing and the statement answers the blocked names.
 *
 * Upsert-then-prune rather than delete-then-insert. Every statement inside a
 * WITH sees the same snapshot, so a DELETE in one CTE does not clear the way
 * for an INSERT in another: the unique index still sees the old rows and
 * rejects the new ones. The prune and the upsert touch disjoint keys, so
 * sharing a snapshot is safe. The list arrives as JSON through
 * jsonb_to_recordset so an empty list stays a valid statement.
 */
export async function saveIngredientBook(groupId: number, prices: PriceInput[]): Promise<WriteResult> {
  const pricesJson = JSON.stringify(prices.map((p) => ({ name: p.name.trim(), kind: p.kind, price: p.pricePerKg })));
  const res = await db.execute(sql`
    WITH p_in AS (
           SELECT name, kind, price::numeric AS price_per_kg
           FROM jsonb_to_recordset(${pricesJson}::jsonb) AS x(name varchar, kind ingredient_kind, price text)
         ),
         blocked AS (
           SELECT p.name FROM p_in p
           JOIN home_made_ingredients h ON h.group_id = ${groupId} AND h.name = p.name AND h.kind = p.kind
         ),
         p_up AS (
           INSERT INTO ingredient_prices (group_id, name, kind, price_per_kg, created_at, updated_at)
           SELECT ${groupId}, name, kind, price_per_kg, now(), now() FROM p_in
           WHERE NOT EXISTS (SELECT 1 FROM blocked)
           ON CONFLICT (group_id, name, kind)
           DO UPDATE SET price_per_kg = EXCLUDED.price_per_kg, updated_at = now()
         ),
         p_del AS (
           DELETE FROM ingredient_prices
           WHERE group_id = ${groupId} AND (name, kind) NOT IN (SELECT name, kind FROM p_in)
             AND NOT EXISTS (SELECT 1 FROM blocked)
         )
    SELECT name FROM blocked
  `);
  const blocked = (res as unknown as { rows: { name: string }[] }).rows;
  if (blocked.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Ingredient "${blocked[0].name}" is home-made; its price is derived from its settings`,
    };
  }
  return { ok: true };
}

/** Removes one home-made ingredient's settings. A recipe row using the name stays; it reads as not set up. */
export async function deleteHomeMade(
  groupId: number,
  name: string,
  kind: 'starter' | 'other'
): Promise<WriteResult> {
  const deleted = await db
    .delete(homeMadeIngredients)
    .where(
      and(
        eq(homeMadeIngredients.groupId, groupId),
        eq(homeMadeIngredients.name, name.trim()),
        eq(homeMadeIngredients.kind, kind)
      )
    )
    .returning({ id: homeMadeIngredients.id });
  if (deleted.length === 0) return { ok: false, status: 404, error: 'Home-made ingredient not found' };
  return { ok: true };
}

/**
 * One home-made ingredient's settings: a single upsert, pruning nothing. For an
 * `other` ingredient it also drops that key's typed price in the same
 * statement (typed-price or home-made, never both).
 */
export async function upsertHomeMade(groupId: number, s: HomeMadeSettings): Promise<WriteResult> {
  const name = s.name.trim();
  await db.execute(sql`
    WITH up AS (
      INSERT INTO home_made_ingredients
        (group_id, name, kind, flour_name, liquid_name, liquid_kind, hydration_pct, waste_factor, created_at, updated_at)
      VALUES (${groupId}, ${name}, ${s.kind}::ingredient_kind, ${s.flourName?.trim() ?? null},
              ${s.liquidName.trim()}, ${s.liquidKind}::ingredient_kind, ${s.hydrationPct},
              ${s.wasteFactor.toFixed(2)}::numeric, now(), now())
      ON CONFLICT (group_id, name, kind)
      DO UPDATE SET flour_name = EXCLUDED.flour_name, liquid_name = EXCLUDED.liquid_name,
                    liquid_kind = EXCLUDED.liquid_kind, hydration_pct = EXCLUDED.hydration_pct,
                    waste_factor = EXCLUDED.waste_factor, updated_at = now()
    )
    DELETE FROM ingredient_prices
    WHERE group_id = ${groupId} AND name = ${name} AND kind = 'other'::ingredient_kind
      AND ${s.kind}::text = 'other'
  `);
  return { ok: true };
}

/**
 * One ingredient's price per kilo. A single upsert: unlike the price-book save
 * it prunes nothing, so a proposal for one ingredient cannot drop the others.
 * A home-made ingredient's price is derived from its settings, never stored here.
 */
export async function upsertIngredientPrice(
  groupId: number,
  p: { name: string; kind: IngredientKind; pricePerKg: string }
): Promise<WriteResult> {
  if (p.kind === 'starter') {
    return { ok: false, status: 400, error: 'The starter price is derived from the starter settings' };
  }
  const name = p.name.trim();
  const [homeMade] = await db
    .select({ id: homeMadeIngredients.id })
    .from(homeMadeIngredients)
    .where(
      and(
        eq(homeMadeIngredients.groupId, groupId),
        eq(homeMadeIngredients.name, name),
        eq(homeMadeIngredients.kind, p.kind)
      )
    )
    .limit(1);
  if (homeMade) {
    return { ok: false, status: 400, error: `"${name}" is home-made; its price is derived from its settings` };
  }
  await db
    .insert(ingredientPrices)
    .values({ groupId, name, kind: p.kind, pricePerKg: p.pricePerKg })
    .onConflictDoUpdate({
      target: [ingredientPrices.groupId, ingredientPrices.name, ingredientPrices.kind],
      set: { pricePerKg: p.pricePerKg, updatedAt: sql`now()` },
    });
  return { ok: true };
}
