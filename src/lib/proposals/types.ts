import { z } from 'zod/v4';
import { PRICE_INPUT } from '@/lib/pricing';
import { recipeInputSchema, type WriteResult } from '@/lib/catalog-writes';

/**
 * What Claude may propose, as zod schemas. They are the MCP tools' inputs (one
 * tool per kind) and the one place the proposal engine's kinds are typed.
 */

export type ProposalKind = 'recipe' | 'size_price' | 'bread_price' | 'deal' | 'ingredient_price';

const id = z.number().int().positive();
const price = z.string().regex(PRICE_INPUT);

// The recipe sheet's row (see recipeInputSchema), except that an omitted
// sortOrder is left open here so the kind can fill in the row's position
// instead of every row defaulting to 0. validateRecipe re-checks the rest.
const recipeRow = z
  .object({
    name: z.string().min(1).max(100),
    kind: z.enum(['flour', 'water', 'salt', 'starter', 'other']),
    sortOrder: z.number().int().nonnegative().optional(),
    grams: z.number().positive().optional(),
    pctOfFinished: z.number().positive().optional(),
  })
  .refine((r) => (r.grams === undefined) !== (r.pctOfFinished === undefined), {
    message: 'Each ingredient needs exactly one of grams or pctOfFinished',
  });

export const recipeProposalSchema = z.object({
  breadTypeId: id,
  referenceFinishedGrams: recipeInputSchema.shape.referenceFinishedGrams,
  ingredients: z.array(recipeRow).min(1),
});

export const sizePriceProposalSchema = z.object({ breadSizeId: id, price });

export const breadPriceProposalSchema = z.object({
  breadTypeId: id,
  breadSizeId: id,
  /** null removes the bread's own price for this size. */
  price: price.nullable(),
});

export const dealProposalSchema = z.object({
  breadSizeId: id,
  /** null is the size-wide deal. */
  breadTypeId: id.nullable(),
  minQty: z.number().int().min(2),
  /** null removes the deal. */
  price: price.nullable(),
});

export const ingredientPriceProposalSchema = z.object({
  name: z.string().trim().min(1).max(100),
  ingredientKind: z.enum(['flour', 'water', 'salt', 'starter', 'other']),
  pricePerKg: price,
});

export type ProposalInput =
  | ({ kind: 'recipe' } & z.infer<typeof recipeProposalSchema>)
  | ({ kind: 'size_price' } & z.infer<typeof sizePriceProposalSchema>)
  | ({ kind: 'bread_price' } & z.infer<typeof breadPriceProposalSchema>)
  | ({ kind: 'deal' } & z.infer<typeof dealProposalSchema>)
  | ({ kind: 'ingredient_price' } & z.infer<typeof ingredientPriceProposalSchema>);

export type Prepared = {
  /** Ids that say what the proposal is about: kept so approval re-reads the same thing. */
  target: Record<string, unknown>;
  /** The touched values as they were when proposed; null is a row that was absent. */
  before: unknown;
  /** What approval writes; null is a removal. */
  after: unknown;
  /** The Hebrew card text the owner approves. */
  summaryHe: string;
};

export interface KindHandler {
  /** Validates like the mini app's save would, without writing. Errors are English, for Claude. */
  prepare(
    groupId: number,
    input: ProposalInput
  ): Promise<{ ok: true; prepared: Prepared } | { ok: false; error: string }>;
  /** The touched values as they are now, in the same shape as `before`. `{missing:true}` when the row is gone. */
  readBefore(groupId: number, target: Record<string, unknown>): Promise<unknown>;
  /** The write, through the shared catalogue layer. */
  apply(groupId: number, target: Record<string, unknown>, after: unknown): Promise<WriteResult>;
}
