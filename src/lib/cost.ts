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

export type HomeMadeKind = 'starter' | 'other';
export type LiquidKind = 'water' | 'other';

/** How one home-made ingredient (a starter, tangzhong) is made. */
export interface HomeMadeSettings {
  name: string;
  kind: HomeMadeKind;
  /** The one flour it is made from. Null = not set up yet. */
  flourName: string | null;
  liquidName: string;
  liquidKind: LiquidKind;
  /** Liquid per 100 g flour, 1..1000. 100 = equal parts. */
  hydrationPct: number;
  /** Multiplier for what is discarded or lost on the way. 1..10. */
  wasteFactor: number;
}

export interface PriceBook {
  /** ₪ per kg, keyed by priceKey(). A missing key means no price; 0 is a real price. */
  pricePerKg: Record<string, number>;
  /** Home-made ingredients by priceKey(); their ₪/kg is derived, never typed. */
  homeMade: Record<string, HomeMadeSettings>;
}

export interface CostedIngredient {
  name: string;
  kind: IngredientKind;
  grams: number;
  /** null when nothing prices this ingredient — never coerced to 0. */
  pricePerKg: number | null;
  cost: number | null;
  /** True for home-made rows, whose ₪/kg is computed rather than typed. */
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
 * ₪/kg of one home-made ingredient, from the flour and liquid it is made of.
 *
 * At hydration h it is 100 parts flour to h parts liquid, so a kilo is
 * 100/(100+h) flour by weight. The waste factor scales the whole thing: what
 * is discarded or lost is paid for too.
 *
 * Returns null when the flour is unset or unpriced, or an `other` liquid has no
 * price (or is itself home-made) — it then reads as unpriced, never free.
 */
export function homeMadePricePerKg(s: HomeMadeSettings, book: PriceBook): number | null {
  if (!s.flourName) return null;
  const flour = book.pricePerKg[priceKey(s.flourName, 'flour')];
  if (flour === undefined) return null;

  let liquid: number;
  if (s.liquidKind === 'water') {
    liquid = book.pricePerKg[priceKey(s.liquidName, 'water')] ?? waterPricePerKg(book);
  } else {
    const key = priceKey(s.liquidName, 'other');
    if (key in book.homeMade) return null;
    const typed = book.pricePerKg[key];
    if (typed === undefined) return null;
    liquid = typed;
  }

  const flourShare = 100 / (100 + s.hydrationPct);
  const liquidShare = s.hydrationPct / (100 + s.hydrationPct);
  return (flourShare * flour + liquidShare * liquid) * s.wasteFactor;
}

/** Cost one already-scaled recipe. Reads unrounded grams — never the display integer. */
export function costScaledRecipe(scaled: ScaledRecipe, book: PriceBook): LoafCost {
  const ingredients: CostedIngredient[] = scaled.ingredients.map((i) => {
    // A starter row is priced from its home-made settings only (never bought,
    // so no invoice to type in); an `other` row is derived once it has settings.
    const settings = book.homeMade[priceKey(i.name, i.kind)];
    const derived = i.kind === 'starter' || settings !== undefined;
    const pricePerKg = derived
      ? settings
        ? homeMadePricePerKg(settings, book)
        : null
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
