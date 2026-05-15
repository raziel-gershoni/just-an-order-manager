export type IngredientKind = 'flour' | 'water' | 'salt' | 'starter' | 'other';

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
  const ingredients: ScaledIngredient[] = withFlour
    .map((i) => ({
      name: i.name,
      kind: i.kind,
      grams: (i.pctOfFinished * targetFinishedGrams) / 100,
      pctOfFlour: i.pctOfFlour,
      sortOrder: i.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

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
  const ingredients = Array.from(byKey.values()).sort((a, b) => a.sortOrder - b.sortOrder);
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
 * Format:
 *   📝 מתכון להיום:
 *   סורדו (8 כיכרות · 8000ג סופי):
 *     קמח חיטה לבן 5760ג · מים 4032ג · מלח 115ג · מחמצת 1152ג
 */
export function formatRecipeBlockHebrew(
  entries: { name: string; loaves: number; finishedGrams: number; recipe: ScaledRecipe | null }[]
): string {
  const withRecipe = entries.filter((e) => e.recipe && e.recipe.ingredients.length > 0);
  if (withRecipe.length === 0) return '';
  const lines = ['📝 מתכון להיום:'];
  for (const e of withRecipe) {
    lines.push(
      `<b>${e.name}</b> (${e.loaves} כיכרות · ${Math.round(e.finishedGrams)}ג סופי):`
    );
    const ingredients = e.recipe!.ingredients
      .map((i) => `${i.name} ${Math.round(i.grams)}ג`)
      .join(' · ');
    lines.push(`  ${ingredients}`);
  }
  return lines.join('\n');
}
