import { db } from '@/db';
import {
  breadTypes,
  breadSizes,
  breadTypeSizes,
  breadSizeTiers,
  breadRecipeIngredients,
  ingredientPrices,
  homeMadeIngredients,
} from '@/db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { t } from '@/lib/i18n';
import { PRICE_INPUT, canonicalOverridePrice } from '@/lib/pricing';
import { KIND_DISPLAY_ORDER, type IngredientKind, type Recipe } from '@/lib/recipe';
import {
  validateRecipe,
  saveRecipe,
  setSizePrice,
  setBreadSizePriceOverride,
  upsertTier,
  deleteTier,
  upsertIngredientPrice,
  upsertHomeMade,
  type RecipeInput,
  type WriteResult,
} from '@/lib/catalog-writes';
import { totalHydration, type HydrationSplits } from '@/lib/hydration';
import { loadHydrationSplits } from '@/lib/ingredient-costs';
import type { KindHandler, Prepared, ProposalInput, ProposalKind } from './types';

/**
 * One handler per kind of change Claude may propose. `prepare` checks a
 * proposal with the mini app's own rules and captures the values it is based
 * on, `readBefore` reads those same values again at approval (the stale
 * check), and `apply` writes through the shared catalogue layer: the same
 * functions the mini app's routes call, so there is one save path.
 *
 * All errors returned here are English: they go back to Claude, not to a
 * person. The Hebrew is the summary, read from i18n.
 */

type Prep = { ok: true; prepared: Prepared } | { ok: false; error: string };
type Of<K extends ProposalKind> = Extract<ProposalInput, { kind: K }>;

const NOT_FOUND = 'No bread/size/link with that id in this bakery';
const ALREADY = 'Already the current value';
const NO_DEAL = 'No such deal';
const MISSING = { missing: true } as const;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Values compared for staleness are plain JSON: keys sorted, so key order never matters. */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export function sameBefore(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

// ---- Formatting ----

// One pass with a function replacer: a name that itself contains "{to}" or "$&"
// (names come from Claude) must show on the card exactly as typed, not get
// substituted into by a later variable or by replace()'s special patterns.
function fill(key: string, vars: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Names go onto a plain-text card: a line break in one could fake a line of the card. */
// Format characters (\p{Cf}) include the bidi overrides and isolates: one at the
// end of a name would reorder the rest of its card line, so the price shown
// would not be the price stored.
const hasControlChars = (s: string) => /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(s);

/** Every price column is numeric(10,2): a bigger value would only fail at approval. */
const OVER_MAX = 'Price is too large (the maximum is 99999999.99)';
const tooBig = (s: string) => Number(s) >= 1e8;
const MAX_QTY = 2147483647;

/** The numeric(10,2) shape the database holds, and the shape stored in proposals. */
const priceStr = (s: string | number) => Number(s).toFixed(2);

/** Money on the card: 30 stays "30", 35.5 reads "35.50". */
const money = (s: string | number) => priceStr(s).replace(/\.00$/, '');

const pct1 = (n: number | string) => Number(n).toFixed(1);

// ---- Lookups (all scoped to the bakery) ----

async function findSize(groupId: number, breadSizeId: number) {
  const [row] = await db
    .select({ id: breadSizes.id, name: breadSizes.name, price: breadSizes.price })
    .from(breadSizes)
    .where(and(eq(breadSizes.id, breadSizeId), eq(breadSizes.groupId, groupId)))
    .limit(1);
  return row;
}

async function findBread(groupId: number, breadTypeId: number) {
  const [row] = await db
    .select({ id: breadTypes.id, name: breadTypes.name })
    .from(breadTypes)
    .where(and(eq(breadTypes.id, breadTypeId), eq(breadTypes.groupId, groupId)))
    .limit(1);
  return row;
}

async function findLink(groupId: number, breadTypeId: number, breadSizeId: number) {
  const [row] = await db
    .select({
      breadName: breadTypes.name,
      sizeName: breadSizes.name,
      basePrice: breadSizes.price,
      priceOverride: breadTypeSizes.priceOverride,
    })
    .from(breadTypeSizes)
    .innerJoin(breadTypes, eq(breadTypes.id, breadTypeSizes.breadTypeId))
    .innerJoin(breadSizes, eq(breadSizes.id, breadTypeSizes.breadSizeId))
    .where(
      and(
        eq(breadTypeSizes.breadTypeId, breadTypeId),
        eq(breadTypeSizes.breadSizeId, breadSizeId),
        eq(breadTypes.groupId, groupId),
        eq(breadSizes.groupId, groupId)
      )
    )
    .limit(1);
  return row;
}

// ---- recipe ----

type CanonIngredient = { name: string; kind: IngredientKind; pct: string };

/**
 * A recipe as compared and shown: names trimmed (old rows can carry stray
 * spaces that the save trims anyway), percentages to the stored 4 dp, sorted by
 * name|kind. Row order and sortOrder do not count, and an untouched recipe
 * always reads back the same. No rows is `null`, the same as "no recipe".
 */
function canonRecipe(rows: { name: string; kind: IngredientKind; pct: number | string }[]): CanonIngredient[] | null {
  if (rows.length === 0) return null;
  return rows
    .map((r) => ({ name: r.name.trim(), kind: r.kind, pct: Number(r.pct).toFixed(4) }))
    .sort((a, b) => {
      const ka = `${a.name}|${a.kind}`;
      const kb = `${b.name}|${b.kind}`;
      return ka < kb ? -1 : ka > kb ? 1 : a.pct < b.pct ? -1 : a.pct > b.pct ? 1 : 0;
    });
}

async function readRecipe(groupId: number, breadTypeId: number) {
  if (!(await findBread(groupId, breadTypeId))) return MISSING;
  const rows = await db
    .select({
      name: breadRecipeIngredients.name,
      kind: breadRecipeIngredients.kind,
      pct: breadRecipeIngredients.pctOfFinished,
    })
    .from(breadRecipeIngredients)
    .where(eq(breadRecipeIngredients.breadTypeId, breadTypeId))
    .orderBy(asc(breadRecipeIngredients.sortOrder), asc(breadRecipeIngredients.id));
  return canonRecipe(rows);
}

function recipeSummary(
  breadName: string,
  before: CanonIngredient[] | null,
  after: { name: string; kind: IngredientKind; pct: string; sortOrder: number }[],
  splits: HydrationSplits
): string {
  const beforeByKey = new Map((before ?? []).map((b) => [`${b.name}|${b.kind}`, b]));
  const afterKeys = new Set(after.map((a) => `${a.name}|${a.kind}`));

  // Changed and added rows in the new recipe's own order, then removed ones in
  // the old order; a stable sort by kind then groups them the way every recipe
  // surface does. Unchanged rows say nothing.
  const lines: { kind: IngredientKind; text: string }[] = [];
  for (const a of [...after].sort((x, y) => x.sortOrder - y.sortOrder)) {
    const prev = beforeByKey.get(`${a.name}|${a.kind}`);
    if (!prev) {
      lines.push({ kind: a.kind, text: fill('proposal.recipe_added', { name: a.name, to: pct1(a.pct) }) });
    } else if (prev.pct !== a.pct) {
      lines.push({
        kind: a.kind,
        text: fill('proposal.recipe_changed', { name: a.name, from: pct1(prev.pct), to: pct1(a.pct) }),
      });
    }
  }
  for (const b of before ?? []) {
    if (!afterKeys.has(`${b.name}|${b.kind}`)) {
      lines.push({ kind: b.kind, text: fill('proposal.recipe_removed', { name: b.name }) });
    }
  }
  lines.sort((x, y) => KIND_DISPLAY_ORDER.indexOf(x.kind) - KIND_DISPLAY_ORDER.indexOf(y.kind));

  const out = [fill('proposal.recipe_title', { bread: breadName }), ...lines.map((l) => l.text)];
  if (before) {
    // Total hydration: the flour and liquid inside home-made rows count.
    const total = (rows: { name: string; kind: IngredientKind; pct: string }[]) =>
      totalHydration(rows.map((r) => ({ name: r.name, kind: r.kind, pct: Number(r.pct) })), splits);
    const afterTotal = total(after);
    const from = pct1(total(before).pct ?? 0);
    const to = pct1(afterTotal.pct ?? 0);
    if (from !== to) {
      // A starter with no settings is left out of the figure; say which.
      const leavesOut = afterTotal.leavesOut.length
        ? fill('proposal.recipe_hydration_leaves_out', { names: afterTotal.leavesOut.join(', ') })
        : '';
      out.push(fill('proposal.recipe_hydration', { from, to }) + leavesOut);
    }
  }
  return out.join('\n');
}

async function prepareRecipe(groupId: number, input: Of<'recipe'>): Promise<Prep> {
  const bread = await findBread(groupId, input.breadTypeId);
  if (!bread) return fail(NOT_FOUND);

  const rows = input.ingredients.map((r, i) => ({ ...r, name: r.name.trim(), sortOrder: r.sortOrder ?? i }));
  if (rows.some((r) => r.name === '')) return fail('Ingredient names cannot be blank');
  if (rows.some((r) => hasControlChars(r.name))) return fail('Ingredient names cannot contain line breaks or control characters');
  const checked = validateRecipe({
    referenceFinishedGrams: input.referenceFinishedGrams,
    ingredients: rows,
  } as RecipeInput);
  if (!checked.ok) return fail(checked.error);

  const after = checked.recipe.ingredients.map((i) => ({
    name: i.name,
    kind: i.kind,
    pct: i.pctOfFinished.toFixed(4),
    sortOrder: i.sortOrder,
  }));
  // pct_of_finished is numeric(7,4): a bigger value would fail at approval.
  if (after.some((i) => Number(i.pct) >= 1000)) return fail('An ingredient is over 1000% of the finished loaf');

  const [before, splits] = await Promise.all([readRecipe(groupId, input.breadTypeId), loadHydrationSplits(groupId)]);
  if (!Array.isArray(before) && before !== null) return fail(NOT_FOUND);
  if (sameBefore(before, canonRecipe(after))) return fail(ALREADY);

  return {
    ok: true,
    prepared: {
      target: { breadTypeId: input.breadTypeId },
      before,
      after: {
        ingredients: checked.recipe.ingredients.map((i) => ({
          name: i.name,
          kind: i.kind,
          pctOfFinished: i.pctOfFinished,
          sortOrder: i.sortOrder,
        })),
      },
      summaryHe: recipeSummary(bread.name, before, after, splits),
    },
  };
}

// ---- size_price ----

async function readSizePrice(groupId: number, target: Record<string, unknown>) {
  const size = await findSize(groupId, Number(target.breadSizeId));
  return size ? { price: priceStr(size.price) } : MISSING;
}

async function prepareSizePrice(groupId: number, input: Of<'size_price'>): Promise<Prep> {
  if (!PRICE_INPUT.test(input.price)) return fail('Price must look like 35 or 35.50');
  if (tooBig(input.price)) return fail(OVER_MAX);
  const size = await findSize(groupId, input.breadSizeId);
  if (!size) return fail(NOT_FOUND);

  const before = { price: priceStr(size.price) };
  const after = { price: priceStr(input.price) };
  if (sameBefore(before, after)) return fail(ALREADY);
  return {
    ok: true,
    prepared: {
      target: { breadSizeId: input.breadSizeId },
      before,
      after,
      summaryHe: fill('proposal.size_price', {
        size: size.name,
        from: money(before.price),
        to: money(after.price),
      }),
    },
  };
}

// ---- bread_price ----

async function readBreadPrice(groupId: number, target: Record<string, unknown>) {
  const link = await findLink(groupId, Number(target.breadTypeId), Number(target.breadSizeId));
  return link ? breadPriceBefore(link) : MISSING;
}

// The size's own price is part of what the card shows (as the "from" price, or
// as the price a reset falls back to), so it is part of the snapshot: if it
// changes before approval, the card no longer describes the result.
function breadPriceBefore(link: { priceOverride: string | null; basePrice: string }) {
  return {
    priceOverride: link.priceOverride === null ? null : priceStr(link.priceOverride),
    basePrice: priceStr(link.basePrice),
  };
}

async function prepareBreadPrice(groupId: number, input: Of<'bread_price'>): Promise<Prep> {
  if (input.price !== null && !PRICE_INPUT.test(input.price)) return fail('Price must look like 35 or 35.50');
  if (input.price !== null && tooBig(input.price)) return fail(OVER_MAX);
  const link = await findLink(groupId, input.breadTypeId, input.breadSizeId);
  if (!link) return fail(NOT_FOUND);

  const before = breadPriceBefore(link);
  // A price equal to the size's own is not an override: it is stored as none.
  const canon = input.price === null ? '' : canonicalOverridePrice(input.price, link.basePrice);
  const after = { priceOverride: canon === '' ? null : canon };
  if (before.priceOverride === after.priceOverride) return fail(ALREADY);

  const names = { bread: link.breadName, size: link.sizeName };
  const to = after.priceOverride ?? link.basePrice;
  return {
    ok: true,
    prepared: {
      target: { breadTypeId: input.breadTypeId, breadSizeId: input.breadSizeId },
      before,
      after,
      summaryHe:
        after.priceOverride === null
          ? fill('proposal.bread_price_reset', { ...names, to: money(to) })
          : fill('proposal.bread_price', {
              ...names,
              from: money(before.priceOverride ?? link.basePrice),
              to: money(to),
            }),
    },
  };
}

// ---- deal ----

type DealTarget = { breadSizeId: number; breadTypeId: number | null; minQty: number };

async function readDeal(groupId: number, target: Record<string, unknown>) {
  const { breadSizeId, breadTypeId, minQty } = target as DealTarget;
  if (!(await findSize(groupId, breadSizeId))) return MISSING;
  if (breadTypeId !== null && !(await findBread(groupId, breadTypeId))) return MISSING;
  const [tier] = await db
    .select({ price: breadSizeTiers.price })
    .from(breadSizeTiers)
    .where(
      and(
        eq(breadSizeTiers.groupId, groupId),
        eq(breadSizeTiers.breadSizeId, breadSizeId),
        breadTypeId === null ? sql`${breadSizeTiers.breadTypeId} IS NULL` : eq(breadSizeTiers.breadTypeId, breadTypeId),
        eq(breadSizeTiers.minQty, minQty)
      )
    )
    .orderBy(asc(breadSizeTiers.id))
    .limit(1);
  return { price: tier ? priceStr(tier.price) : null };
}

async function prepareDeal(groupId: number, input: Of<'deal'>): Promise<Prep> {
  if (input.price !== null && !PRICE_INPUT.test(input.price)) return fail('Price must look like 35 or 35.50');
  if (input.price !== null && tooBig(input.price)) return fail(OVER_MAX);
  if (!Number.isInteger(input.minQty) || input.minQty < 2 || input.minQty > MAX_QTY) {
    return fail('A deal needs a quantity of at least 2');
  }
  const size = await findSize(groupId, input.breadSizeId);
  if (!size) return fail(NOT_FOUND);
  const bread = input.breadTypeId === null ? null : await findBread(groupId, input.breadTypeId);
  if (input.breadTypeId !== null && !bread) return fail(NOT_FOUND);

  const target: DealTarget = { breadSizeId: input.breadSizeId, breadTypeId: input.breadTypeId, minQty: input.minQty };
  const before = (await readDeal(groupId, target)) as { price: string | null };
  const after = { price: input.price === null ? null : priceStr(input.price) };
  if (after.price === null && before.price === null) return fail(NO_DEAL);
  if (sameBefore(before, after)) return fail(ALREADY);

  const vars = {
    size: size.name,
    forBread: bread ? fill('proposal.deal_for_bread', { bread: bread.name }) : '',
    qty: input.minQty,
  };
  const summaryHe =
    after.price === null
      ? fill('proposal.deal_removed', { ...vars, from: money(before.price!) })
      : fill('proposal.deal_set', { ...vars, to: money(after.price) }) +
        (before.price === null ? '' : fill('proposal.deal_was', { from: money(before.price) }));
  return { ok: true, prepared: { target, before, after, summaryHe } };
}

async function applyDeal(groupId: number, target: Record<string, unknown>, after: unknown): Promise<WriteResult> {
  const { breadSizeId, breadTypeId, minQty } = target as DealTarget;
  const { price } = after as { price: string | null };
  if (price === null) return deleteTier(groupId, { breadSizeId, breadTypeId, minQty });
  const saved = await upsertTier(groupId, { breadSizeId, breadTypeId, minQty, price });
  return saved.ok ? { ok: true } : saved;
}

// ---- ingredient_price ----

async function readIngredientPrice(groupId: number, target: Record<string, unknown>) {
  const [row] = await db
    .select({ pricePerKg: ingredientPrices.pricePerKg })
    .from(ingredientPrices)
    .where(
      and(
        eq(ingredientPrices.groupId, groupId),
        eq(ingredientPrices.name, String(target.name)),
        eq(ingredientPrices.kind, target.ingredientKind as IngredientKind)
      )
    )
    .limit(1);
  return { pricePerKg: row ? priceStr(row.pricePerKg) : null };
}

async function prepareIngredientPrice(groupId: number, input: Of<'ingredient_price'>): Promise<Prep> {
  const name = input.name.trim();
  if (name === '') return fail('Ingredient name cannot be blank');
  if (hasControlChars(name)) return fail('Ingredient name cannot contain line breaks or control characters');
  if (input.ingredientKind === 'starter') {
    return fail('The starter price is derived from the starter settings and cannot be proposed');
  }
  if (!PRICE_INPUT.test(input.pricePerKg)) return fail('Price must look like 35 or 35.50');
  if (tooBig(input.pricePerKg)) return fail(OVER_MAX);
  if (await findHomeMade(groupId, name, input.ingredientKind)) {
    return fail(`${name} is home-made: propose_home_made_ingredient sets it`);
  }

  const target = { name, ingredientKind: input.ingredientKind };
  const before = (await readIngredientPrice(groupId, target)) as { pricePerKg: string | null };
  const after = { pricePerKg: priceStr(input.pricePerKg) };
  if (sameBefore(before, after)) return fail(ALREADY);
  return {
    ok: true,
    prepared: {
      target,
      before,
      after,
      summaryHe:
        before.pricePerKg === null
          ? fill('proposal.ingredient_price_new', { name, to: money(after.pricePerKg) })
          : fill('proposal.ingredient_price', { name, from: money(before.pricePerKg), to: money(after.pricePerKg) }),
    },
  };
}

// ---- home_made ----

type HomeMadeBefore = {
  settings: {
    flourName: string | null;
    liquidName: string;
    liquidKind: 'water' | 'other';
    hydrationPct: number;
    wasteFactor: string;
  } | null;
  typedPrice: string | null;
};

async function findHomeMade(groupId: number, name: string, kind: IngredientKind) {
  const [row] = await db
    .select({
      flourName: homeMadeIngredients.flourName,
      liquidName: homeMadeIngredients.liquidName,
      liquidKind: homeMadeIngredients.liquidKind,
      hydrationPct: homeMadeIngredients.hydrationPct,
      wasteFactor: homeMadeIngredients.wasteFactor,
    })
    .from(homeMadeIngredients)
    .where(
      and(
        eq(homeMadeIngredients.groupId, groupId),
        eq(homeMadeIngredients.name, name),
        eq(homeMadeIngredients.kind, kind)
      )
    )
    .limit(1);
  return row;
}

async function readHomeMade(
  groupId: number,
  target: { name: string; ingredientKind: IngredientKind }
): Promise<HomeMadeBefore> {
  const row = await findHomeMade(groupId, target.name, target.ingredientKind);
  const typed = (await readIngredientPrice(groupId, target)) as { pricePerKg: string | null };
  return {
    settings: row
      ? {
          flourName: row.flourName,
          liquidName: row.liquidName,
          liquidKind: row.liquidKind as 'water' | 'other',
          hydrationPct: row.hydrationPct,
          wasteFactor: Number(row.wasteFactor).toFixed(2),
        }
      : null,
    typedPrice: typed.pricePerKg,
  };
}

async function prepareHomeMade(groupId: number, input: Of<'home_made'>): Promise<Prep> {
  const name = input.name.trim();
  const flourName = input.flourName.trim();
  const liquidName = input.liquidName.trim();
  if (name === '' || flourName === '' || liquidName === '') return fail('Names cannot be blank');
  if ([name, flourName, liquidName].some(hasControlChars)) {
    return fail('Names cannot contain line breaks or control characters');
  }
  if (liquidName === name && input.liquidKind === 'other') {
    return fail('A home-made ingredient cannot be its own liquid');
  }
  if (input.liquidKind === 'other') {
    // The liquid of kind "starter" cannot be expressed (liquidKind is water|other),
    // so a starter's name given as an "other" liquid is refused by name.
    if (await findHomeMade(groupId, liquidName, 'starter')) {
      return fail(`${liquidName} is a starter: a home-made ingredient cannot be made from another home-made ingredient`);
    }
    if (await findHomeMade(groupId, liquidName, 'other')) {
      return fail(`${liquidName} is home-made: a home-made ingredient cannot be made from another home-made ingredient`);
    }
  }

  const target = { name, ingredientKind: input.ingredientKind };
  const before = await readHomeMade(groupId, target);
  const after = {
    flourName,
    liquidName,
    liquidKind: input.liquidKind,
    hydrationPct: input.hydrationPct,
    wasteFactor: input.wasteFactor.toFixed(2),
  };
  if (before.settings && sameBefore(before.settings, after)) return fail(ALREADY);

  const fields: { label: string; from: string | null; to: string; changed: boolean }[] = [
    { label: t('proposal.home_made_flour'), from: before.settings?.flourName ?? null, to: flourName, changed: before.settings?.flourName !== flourName },
    { label: t('proposal.home_made_liquid'), from: before.settings?.liquidName ?? null, to: liquidName, changed: before.settings?.liquidName !== liquidName },
    {
      label: t('proposal.home_made_hydration'),
      from: before.settings ? `${before.settings.hydrationPct}%` : null,
      to: `${after.hydrationPct}%`,
      changed: before.settings?.hydrationPct !== after.hydrationPct,
    },
    {
      label: t('proposal.home_made_waste'),
      from: before.settings?.wasteFactor ?? null,
      to: after.wasteFactor,
      changed: before.settings?.wasteFactor !== after.wasteFactor,
    },
  ];
  const lines = fields
    .filter((f) => f.changed)
    .map((f) =>
      before.settings && f.from !== null
        ? fill('proposal.home_made_field', { label: f.label, from: f.from, to: f.to })
        : fill('proposal.home_made_field_new', { label: f.label, to: f.to })
    );
  // A new row (or an unset flour) lists every field, so the card says the whole setup.
  const out = [fill('proposal.home_made_title', { name }), ...lines];
  if (before.typedPrice !== null) out.push(fill('proposal.home_made_drops_price', { price: money(before.typedPrice) }));

  return {
    ok: true,
    prepared: { target, before, after, summaryHe: out.join('\n') },
  };
}

// ---- The table ----

export const KINDS: Record<ProposalKind, KindHandler> = {
  recipe: {
    prepare: (g, i) => prepareRecipe(g, i as Of<'recipe'>),
    readBefore: (g, target) => readRecipe(g, Number(target.breadTypeId)),
    apply: (g, target, after) => saveRecipe(g, Number(target.breadTypeId), after as Recipe),
  },
  size_price: {
    prepare: (g, i) => prepareSizePrice(g, i as Of<'size_price'>),
    readBefore: readSizePrice,
    apply: (g, target, after) => setSizePrice(g, Number(target.breadSizeId), (after as { price: string }).price),
  },
  bread_price: {
    prepare: (g, i) => prepareBreadPrice(g, i as Of<'bread_price'>),
    readBefore: readBreadPrice,
    apply: (g, target, after) =>
      setBreadSizePriceOverride(
        g,
        Number(target.breadTypeId),
        Number(target.breadSizeId),
        (after as { priceOverride: string | null }).priceOverride
      ),
  },
  deal: {
    prepare: (g, i) => prepareDeal(g, i as Of<'deal'>),
    readBefore: readDeal,
    apply: applyDeal,
  },
  ingredient_price: {
    prepare: (g, i) => prepareIngredientPrice(g, i as Of<'ingredient_price'>),
    readBefore: readIngredientPrice,
    apply: (g, target, after) =>
      upsertIngredientPrice(g, {
        name: String(target.name),
        kind: target.ingredientKind as IngredientKind,
        pricePerKg: (after as { pricePerKg: string }).pricePerKg,
      }),
  },
  home_made: {
    prepare: (g, i) => prepareHomeMade(g, i as Of<'home_made'>),
    readBefore: (g, target) =>
      readHomeMade(g, { name: String(target.name), ingredientKind: target.ingredientKind as IngredientKind }),
    apply: (g, target, after) => {
      const a = after as NonNullable<HomeMadeBefore['settings']>;
      return upsertHomeMade(g, {
        name: String(target.name),
        kind: target.ingredientKind as 'starter' | 'other',
        flourName: a.flourName,
        liquidName: a.liquidName,
        liquidKind: a.liquidKind,
        hydrationPct: a.hydrationPct,
        wasteFactor: Number(a.wasteFactor),
      });
    },
  },
};
