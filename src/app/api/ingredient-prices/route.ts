import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { z } from 'zod/v4';
import { KIND_DISPLAY_ORDER, type IngredientKind } from '@/lib/recipe';
import { priceKey } from '@/lib/cost';
import { homeMadeSchema, validateIngredientBook, saveIngredientBook } from '@/lib/catalog-writes';
import {
  loadPriceBook,
  loadPriceRows,
  loadHomeMade,
  loadIngredientsInUse,
  loadBreadsForCosting,
} from '@/lib/ingredient-costs';
import type { AuthContext } from '@/lib/telegram-auth';

/**
 * The ingredient price book, and the per-loaf costs it produces.
 *
 * Owner/manager only, enforced here rather than in JSX: sixteen client-side
 * `{!isBaker && …}` guards already exist in the catalogue page and every one of
 * them ships the data to the browser anyway.
 */

function denyBakers(auth: AuthContext, groupId: number): Response | null {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (membership?.role === 'baker' || membership?.role === 'driver') {
    return errorResponse('Only owners and managers can see ingredient costs', 403);
  }
  return null;
}

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

  const [prices, homeMade, inUse, breads] = await Promise.all([
    loadPriceRows(groupId),
    loadHomeMade(groupId),
    loadIngredientsInUse(groupId),
    loadBreadsForCosting(groupId),
  ]);

  const inUseKeys = new Set(inUse.map((i) => priceKey(i.name, i.kind)));
  // A priced ingredient used only as a home-made flour or liquid is not an
  // orphan: a rye starter is fed rye flour no bread lists on its own.
  const feedingKeys = new Set(
    homeMade.flatMap((h) => [
      ...(h.flourName ? [priceKey(h.flourName, 'flour')] : []),
      priceKey(h.liquidName, h.liquidKind),
    ])
  );
  // Sorted by kind so the screen can render straight down without regrouping.
  const byKindThenName = (a: { name: string; kind: IngredientKind }, b: { name: string; kind: IngredientKind }) =>
    KIND_DISPLAY_ORDER.indexOf(a.kind) - KIND_DISPLAY_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, 'he');

  return jsonResponse({
    book,
    prices,
    inUse: [...inUse].sort(byKindThenName),
    // A saved price whose ingredient is in no recipe. Free-text ingredient
    // names mean a typo mints a new identity and orphans the old price; showing
    // orphans is how that becomes visible the day it happens rather than six
    // months later.
    orphans: prices
      .filter((p) => {
        const key = priceKey(p.name, p.kind);
        return !inUseKeys.has(key) && !feedingKeys.has(key);
      })
      .sort(byKindThenName),
    homeMade,
    // Saved home-made rows whose name is in no recipe (a rename shows here).
    homeMadeOrphans: homeMade.filter((h) => !inUseKeys.has(priceKey(h.name, h.kind))),
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
  homeMade: z.array(homeMadeSchema).max(200),
});

export const PUT = withGroup(async (request, auth, groupId) => {
  const denied = denyBakers(auth, groupId);
  if (denied) return denied;

  const body = await request.json();
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const { prices, homeMade } = parsed.data;

  const checked = validateIngredientBook(prices, homeMade);
  if (!checked.ok) return errorResponse(checked.error, 400);

  try {
    const saved = await saveIngredientBook(groupId, prices, homeMade);
    if (!saved.ok) return errorResponse(saved.error, saved.status);
  } catch (e) {
    console.error('[ingredient-prices] write failed', e);
    return errorResponse('Could not save the ingredient prices', 500);
  }

  return jsonResponse({ ok: true });
});
