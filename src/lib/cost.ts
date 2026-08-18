import type { IngredientKind, ScaledRecipe } from './recipe';

/**
 * What a loaf costs to make, in ingredients.
 *
 * Pure — no DB, no React, no fetch — mirroring src/lib/pricing.ts. Cost is
 * deliberately NOT part of the bulk-pricing engine: that engine decides what a
 * customer is charged, runs on the client, and would drag ingredient prices
 * into the browser bundle. Cost is an orthogonal quantity, composed at the
 * display site.
 *
 * The arithmetic is free because pct_of_finished is already grams per 100 g of
 * FINISHED loaf, with bake loss implicit in the sum (כפרי sums to 105.11 %).
 * scaleRecipe therefore hands us RAW purchased grams; applying a yield factor
 * on top would double-count.
 */

/** The key both this module and sumScaledByType aggregate ingredients on. */
export function priceKey(name: string, kind: IngredientKind): string {
  return `${name}|${kind}`;
}

export interface StarterSettings {
  /** Which flour feeds the starter. Null = not configured. */
  flourName: string | null;
  /** Water as a percentage of the starter's flour. 100 = equal parts. */
  hydrationPct: number;
  /** Multiplier for the portion discarded between feeds. 1 = no waste. */
  wasteFactor: number;
}

export interface PriceBook {
  /** ₪ per kg, keyed by priceKey(). A missing key means no price; 0 is a real price. */
  pricePerKg: Record<string, number>;
  starter: StarterSettings;
}

export interface CostedIngredient {
  name: string;
  kind: IngredientKind;
  grams: number;
  /** null when nothing prices this ingredient — never coerced to 0. */
  pricePerKg: number | null;
  cost: number | null;
  /** True for starter, whose ₪/kg is computed rather than typed. */
  derived: boolean;
}

export interface LoafCost {
  finishedGrams: number;
  /** ₪ for one loaf, counting priced ingredients only. */
  total: number;
  /** ₪ per kg of finished bread. */
  perKg: number;
  ingredients: CostedIngredient[];
  /** Ingredients that carry no price. Never silently zero. */
  unpriced: { name: string; kind: IngredientKind }[];
  complete: boolean;
}

/**
 * Cheapest water in the book, or 0 when the book has no water at all.
 *
 * Water is the one ingredient whose true price is usually zero, and refusing to
 * cost a whole loaf because nobody typed "0" for tap water would be obtuse. A
 * water row the owner HAS priced still wins.
 */
function waterPricePerKg(book: PriceBook): number {
  const prices = Object.entries(book.pricePerKg)
    .filter(([key]) => key.endsWith('|water'))
    .map(([, price]) => price);
  return prices.length > 0 ? Math.min(...prices) : 0;
}

/**
 * ₪/kg of maintained starter, derived from the flour that feeds it.
 *
 * At hydration h the starter is 100 parts flour to h parts water, so a kilo of
 * it is 100/(100+h) flour by weight. The waste factor scales the whole thing:
 * a starter fed twice for every use costs more per gram used than its
 * ingredients, because the discard is paid for too.
 *
 * Returns null when the flour is unset or unpriced — starter then reads as
 * unpriced rather than free.
 */
export function starterPricePerKg(book: PriceBook): number | null {
  const { flourName, hydrationPct, wasteFactor } = book.starter;
  if (!flourName) return null;

  const flour = book.pricePerKg[priceKey(flourName, 'flour')];
  if (flour === undefined) return null;

  const flourShare = 100 / (100 + hydrationPct);
  const waterShare = hydrationPct / (100 + hydrationPct);
  return (flourShare * flour + waterShare * waterPricePerKg(book)) * wasteFactor;
}

/** Cost one already-scaled recipe. Reads unrounded grams — never the display integer. */
export function costScaledRecipe(scaled: ScaledRecipe, book: PriceBook): LoafCost {
  const derivedStarter = starterPricePerKg(book);

  const ingredients: CostedIngredient[] = scaled.ingredients.map((i) => {
    // A starter row is priced by the starter settings, not by a price row of
    // its own: the owner never buys מחמצת, so there is no invoice to type in.
    const derived = i.kind === 'starter';
    const pricePerKg = derived
      ? derivedStarter
      : (book.pricePerKg[priceKey(i.name, i.kind)] ?? null);

    return {
      name: i.name,
      kind: i.kind,
      grams: i.grams,
      pricePerKg,
      cost: pricePerKg === null ? null : (i.grams / 1000) * pricePerKg,
      derived,
    };
  });

  const unpriced = ingredients
    .filter((i) => i.cost === null)
    .map((i) => ({ name: i.name, kind: i.kind }));

  const total = ingredients.reduce((sum, i) => sum + (i.cost ?? 0), 0);

  return {
    finishedGrams: scaled.finishedGrams,
    total,
    perKg: scaled.finishedGrams > 0 ? total / (scaled.finishedGrams / 1000) : 0,
    ingredients,
    unpriced,
    complete: unpriced.length === 0,
  };
}
