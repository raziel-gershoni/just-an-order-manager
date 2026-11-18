import type { IngredientKind } from '@/lib/recipe';

/**
 * Shapes shared by the editor and the copy flow. They live here rather than in
 * either component so the two can import from one place instead of from each
 * other.
 */

/** One recipe in the group, as `GET /api/recipes` returns it. */
export interface GroupRecipe {
  breadTypeId: number;
  breadTypeName: string;
  /** Total hydration: counts the flour and liquid inside home-made ingredients. */
  hydrationPct: number | null;
  /** Home-made names that could not be split (not set up), left out of the figure. */
  hydrationLeavesOut?: string[];
  ingredients: {
    name: string;
    kind: IngredientKind;
    pctOfFinished: number;
    pctOfFlour: number;
    sortOrder: number;
  }[];
}

/** A row handed from the copy flow to the editor, not yet saved anywhere. */
export interface SeedRow {
  name: string;
  kind: IngredientKind;
  /** Exact, carried from the source — never re-derived from a rounded display. */
  pctOfFinished: number;
  sortOrder: number;
}

export type NamesByKind = Record<IngredientKind, string[]>;

export const EMPTY_NAMES: NamesByKind = {
  flour: [],
  water: [],
  salt: [],
  starter: [],
  tangzhong: [],
  other: [],
};
