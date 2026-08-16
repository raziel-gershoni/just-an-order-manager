import { t } from './i18n';

export type IngredientKind = 'flour' | 'water' | 'salt' | 'starter' | 'other';

/** The Hebrew name of a kind — קמח, מים, … — from the one translation table. */
export function kindLabel(kind: IngredientKind): string {
  return t(`settings.kind_${kind}`);
}

/**
 * Whether a group needs its kind spelled out. A lone ״מים״ under a heading
 * reading ״מים״ is noise; two flours under ״קמח״ is the whole point.
 */
export function kindLabelIsUseful(kind: IngredientKind, items: { name: string }[]): boolean {
  return items.length > 1 || items[0]?.name !== kindLabel(kind);
}

/** Canonical display order for ingredient kinds (dry → main hydration → leavening → seasoning → extras). */
export const KIND_DISPLAY_ORDER: IngredientKind[] = ['flour', 'water', 'starter', 'salt', 'other'];

/**
 * Bucket ingredients by `kind` in canonical order. Returns one entry per kind
 * that has at least one ingredient, preserving the input's sortOrder within each bucket.
 */
export function groupByKind<T extends { kind: IngredientKind; sortOrder: number }>(
  items: T[]
): { kind: IngredientKind; items: T[] }[] {
  const buckets = new Map<IngredientKind, T[]>();
  for (const it of items) {
    if (!buckets.has(it.kind)) buckets.set(it.kind, []);
    buckets.get(it.kind)!.push(it);
  }
  for (const arr of buckets.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return KIND_DISPLAY_ORDER.filter((k) => buckets.has(k)).map((k) => ({
    kind: k,
    items: buckets.get(k)!,
  }));
}

/**
 * The same canonical order, flattened — for surfaces that render one list
 * rather than labelled groups. Two flours entered at either end of a recipe's
 * sortOrder still come out adjacent, which is the whole point: nobody weighs
 * flour, then water, then flour again.
 */
export function sortByKind<T extends { kind: IngredientKind; sortOrder: number }>(
  items: T[]
): T[] {
  return groupByKind(items).flatMap((g) => g.items);
}

export type RecipeIngredient = {
  name: string;
  kind: IngredientKind;
  pctOfFinished: number;
  sortOrder: number;
};

export type Recipe = {
  ingredients: RecipeIngredient[];
};

export type ScaledIngredient = {
  name: string;
  kind: IngredientKind;
  grams: number;
  pctOfFlour: number;
  sortOrder: number;
};

export type ScaledRecipe = {
  ingredients: ScaledIngredient[];
  totalFlourGrams: number;
  totalDoughGrams: number;
  finishedGrams: number;
};

function totalFlourPct(recipe: Recipe): number {
  return recipe.ingredients
    .filter((i) => i.kind === 'flour')
    .reduce((sum, i) => sum + i.pctOfFinished, 0);
}

function withPctOfFlour(recipe: Recipe): { name: string; kind: IngredientKind; pctOfFinished: number; pctOfFlour: number; sortOrder: number }[] {
  const flourTotal = totalFlourPct(recipe);
  return recipe.ingredients.map((i) => ({
    ...i,
    pctOfFlour: flourTotal > 0 ? (i.pctOfFinished / flourTotal) * 100 : 0,
  }));
}

export function scaleRecipe(recipe: Recipe, targetFinishedGrams: number): ScaledRecipe {
  const withFlour = withPctOfFlour(recipe);
  // Kind order, not entry order: a scaled recipe is a weigh-out list, and every
  // surface that renders one wants the flours together. Setting it here means
  // no caller can forget — the editor keeps entry order, everyone else inherits
  // this.
  const ingredients: ScaledIngredient[] = sortByKind(
    withFlour.map((i) => ({
      name: i.name,
      kind: i.kind,
      grams: (i.pctOfFinished * targetFinishedGrams) / 100,
      pctOfFlour: i.pctOfFlour,
      sortOrder: i.sortOrder,
    }))
  );

  const totalFlourGrams = ingredients
    .filter((i) => i.kind === 'flour')
    .reduce((sum, i) => sum + i.grams, 0);
  const totalDoughGrams = ingredients.reduce((sum, i) => sum + i.grams, 0);

  return {
    ingredients,
    totalFlourGrams,
    totalDoughGrams,
    finishedGrams: targetFinishedGrams,
  };
}

export function scaleRecipeByQty(
  recipe: Recipe,
  perLoafFinishedGrams: number,
  qty: number
): ScaledRecipe {
  return scaleRecipe(recipe, perLoafFinishedGrams * qty);
}

/**
 * Sum scaled recipes that share the same recipe shape (same ingredient names + kinds).
 * Used to combine multiple sizes of the same bread type for a daily total.
 */
export function sumScaledByType(scaled: ScaledRecipe[]): ScaledRecipe {
  if (scaled.length === 0) {
    return { ingredients: [], totalFlourGrams: 0, totalDoughGrams: 0, finishedGrams: 0 };
  }
  if (scaled.length === 1) return scaled[0];

  const byKey = new Map<string, ScaledIngredient>();
  for (const s of scaled) {
    for (const ing of s.ingredients) {
      const key = `${ing.name}|${ing.kind}`;
      const prev = byKey.get(key);
      if (prev) {
        prev.grams += ing.grams;
      } else {
        byKey.set(key, { ...ing });
      }
    }
  }
  const ingredients = sortByKind(Array.from(byKey.values()));
  const totalFlourGrams = ingredients
    .filter((i) => i.kind === 'flour')
    .reduce((sum, i) => sum + i.grams, 0);
  const totalDoughGrams = ingredients.reduce((sum, i) => sum + i.grams, 0);
  const finishedGrams = scaled.reduce((sum, s) => sum + s.finishedGrams, 0);
  return { ingredients, totalFlourGrams, totalDoughGrams, finishedGrams };
}

export type RecipeWithBakers = ReturnType<typeof withBakersPercents>;

export function withBakersPercents(recipe: Recipe) {
  return {
    ingredients: withPctOfFlour(recipe).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

/**
 * Build a Recipe (pctOfFinished form) from baker's gram entry — used at save time in the editor.
 */
export function recipeFromGrams(
  referenceFinishedGrams: number,
  rows: { name: string; kind: IngredientKind; grams: number; sortOrder: number }[]
): Recipe {
  if (referenceFinishedGrams <= 0) {
    throw new Error('referenceFinishedGrams must be > 0');
  }
  return {
    ingredients: rows.map((r) => ({
      name: r.name,
      kind: r.kind,
      pctOfFinished: (r.grams / referenceFinishedGrams) * 100,
      sortOrder: r.sortOrder,
    })),
  };
}

/**
 * Format a number of grams for display (rounded to nearest int, with 'g' suffix in Hebrew context — caller adds suffix).
 */
export function gramsRounded(grams: number): number {
  return Math.round(grams);
}

/**
 * Build the Hebrew recipe block used in the Telegram morning summary and bot /today output.
 * Entries with no recipe are silently skipped. Returns empty string if nothing to show.
 *
 * One line per ingredient kind, in the canonical weighing order, so the flours
 * arrive together and carry their combined weight — the number you set the
 * scale to before you start.
 *
 * Format:
 *   📝 מתכון להיום:
 *   סורדו (8 כיכרות · 8000ג סופי):
 *     קמח 5760ג: חיטה לבן 4608ג · מלא 1152ג
 *     מים 4032ג
 *     מחמצת 1152ג
 *     מלח 115ג
 */
export function formatRecipeBlockHebrew(
  entries: { name: string; loaves: number; finishedGrams: number; recipe: ScaledRecipe | null }[]
): string {
  const withRecipe = entries.filter((e) => e.recipe && e.recipe.ingredients.length > 0);
  if (withRecipe.length === 0) return '';
  const g = (grams: number) => `${Math.round(grams)}ג`;
  const lines = ['📝 מתכון להיום:'];
  for (const e of withRecipe) {
    lines.push(`<b>${e.name}</b> (${e.loaves} כיכרות · ${g(e.finishedGrams)} סופי):`);
    for (const group of groupByKind(e.recipe!.ingredients)) {
      const items = group.items.map((i) => `${i.name} ${g(i.grams)}`).join(' · ');
      if (!kindLabelIsUseful(group.kind, group.items)) {
        lines.push(`  ${items}`);
        continue;
      }
      const total = group.items.reduce((sum, i) => sum + i.grams, 0);
      // The kind total only says something the line doesn't when it's a sum.
      const head = group.items.length > 1 ? `${kindLabel(group.kind)} ${g(total)}` : kindLabel(group.kind);
      lines.push(`  ${head}: ${items}`);
    }
  }
  return lines.join('\n');
}
