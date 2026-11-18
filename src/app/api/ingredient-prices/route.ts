import { withGroup, jsonResponse, errorResponse, denyBakers } from '@/lib/api-utils';
import { z } from 'zod/v4';
import { KIND_DISPLAY_ORDER, type IngredientKind } from '@/lib/recipe';
import { validateIngredientBook, saveIngredientBook } from '@/lib/catalog-writes';
import {
  loadPriceBook,
  loadPriceRows,
  loadIngredientsForPricing,
  orphanPrices,
  loadBreadsForCosting,
} from '@/lib/ingredient-costs';

/**
 * The ingredient price book, and the per-loaf costs it produces. Prices only:
 * home-made settings live in /api/home-made.
 *
 * Owner/manager only, enforced here rather than in JSX: sixteen client-side
 * `{!isBaker && …}` guards already exist in the catalogue page and every one of
 * them ships the data to the browser anyway.
 */

export const GET = withGroup(async (request, auth, groupId) => {
  const denied = denyBakers(auth, groupId);
  if (denied) return denied;

  const book = await loadPriceBook(groupId);

  // `?scope=book` is the cheap read: the recipe editor wants a cost line and
  // already holds the recipe, so shipping every bread's percentages to it on
  // every sheet open would repeat the mistake this work is fixing elsewhere.
  if (new URL(request.url).searchParams.get('scope') === 'book') {
    return jsonResponse({ book });
  }

  const [prices, inUse, breads] = await Promise.all([
    loadPriceRows(groupId),
    loadIngredientsForPricing(groupId),
    loadBreadsForCosting(groupId),
  ]);

  // Sorted by kind so the screen can render straight down without regrouping.
  const byKindThenName = (a: { name: string; kind: IngredientKind }, b: { name: string; kind: IngredientKind }) =>
    KIND_DISPLAY_ORDER.indexOf(a.kind) - KIND_DISPLAY_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, 'he');

  return jsonResponse({
    book,
    prices,
    inUse: [...inUse].sort(byKindThenName),
    // A saved price whose ingredient is on the list above (in a recipe, or
    // feeding a home-made entry) is not an orphan.
    orphans: orphanPrices(prices, inUse).sort(byKindThenName),
    breads,
  });
});

const putSchema = z.object({
  prices: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        kind: z.enum(['flour', 'water', 'salt', 'starter', 'other']),
        pricePerKg: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Price must be a number like 5 or 5.40'),
      })
    )
    .max(200),
});

export const PUT = withGroup(async (request, auth, groupId) => {
  const denied = denyBakers(auth, groupId);
  if (denied) return denied;

  const body = await request.json();
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const { prices } = parsed.data;

  const checked = validateIngredientBook(prices);
  if (!checked.ok) return errorResponse(checked.error, 400);

  try {
    const saved = await saveIngredientBook(groupId, prices);
    if (!saved.ok) return errorResponse(saved.error, saved.status);
  } catch (e) {
    console.error('[ingredient-prices] write failed', e);
    return errorResponse('Could not save the ingredient prices', 500);
  }

  return jsonResponse({ ok: true });
});
