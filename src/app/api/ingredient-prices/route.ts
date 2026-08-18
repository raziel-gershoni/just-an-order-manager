import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { KIND_DISPLAY_ORDER } from '@/lib/recipe';
import { priceKey } from '@/lib/cost';
import {
  loadPriceBook,
  loadPriceRows,
  loadIngredientsInUse,
  loadLoafCosts,
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

export const GET = withGroup(async (_request, auth, groupId) => {
  const denied = denyBakers(auth, groupId);
  if (denied) return denied;

  const book = await loadPriceBook(groupId);
  const [prices, inUse, loaves] = await Promise.all([
    loadPriceRows(groupId),
    loadIngredientsInUse(groupId),
    loadLoafCosts(groupId, book),
  ]);

  const inUseKeys = new Set(inUse.map((i) => priceKey(i.name, i.kind)));

  return jsonResponse({
    prices,
    // Sorted by kind so the screen can render straight down without regrouping.
    inUse: [...inUse].sort(
      (a, b) =>
        KIND_DISPLAY_ORDER.indexOf(a.kind) - KIND_DISPLAY_ORDER.indexOf(b.kind) ||
        a.name.localeCompare(b.name, 'he')
    ),
    // A saved price whose ingredient is in no recipe. Free-text ingredient
    // names mean a typo mints a new identity and orphans the old price; showing
    // orphans is how that becomes visible the day it happens rather than six
    // months later.
    orphans: prices.filter((p) => !inUseKeys.has(priceKey(p.name, p.kind))),
    starter: book.starter,
    loaves,
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
  starter: z.object({
    flourName: z.string().trim().min(1).max(100).nullable(),
    hydrationPct: z.number().int().min(1).max(500),
    wasteFactor: z.number().min(1).max(10),
  }),
});

export const PUT = withGroup(async (request, auth, groupId) => {
  const denied = denyBakers(auth, groupId);
  if (denied) return denied;

  const body = await request.json();
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const { prices, starter } = parsed.data;

  // The unique index would reject this anyway, with a Postgres error the owner
  // can't read.
  const keys = prices.map((p) => priceKey(p.name, p.kind));
  const duplicate = keys.find((k, i) => keys.indexOf(k) !== i);
  if (duplicate) {
    return errorResponse(`Ingredient "${duplicate.slice(0, duplicate.lastIndexOf('|'))}" appears twice`, 400);
  }

  const starterUpdate = sql`
    UPDATE groups SET
      starter_flour_name = ${starter.flourName},
      starter_hydration_pct = ${starter.hydrationPct},
      starter_waste_factor = ${starter.wasteFactor.toFixed(2)}
    WHERE id = ${groupId}
  `;
  const clear = sql`DELETE FROM ingredient_prices WHERE group_id = ${groupId}`;

  // One statement, because neon-http has no interactive transactions: a
  // two-statement swap can strand the group with its settings updated and its
  // prices gone, which reads as "nothing is priced" on every cost surface.
  if (prices.length === 0) {
    await db.execute(sql`WITH g AS (${starterUpdate}) ${clear}`);
  } else {
    const values = prices.map(
      (p) =>
        sql`(${groupId}, ${p.name}, ${p.kind}::ingredient_kind, ${p.pricePerKg}, now(), now())`
    );
    await db.execute(sql`
      WITH g AS (${starterUpdate}), cleared AS (${clear})
      INSERT INTO ingredient_prices (group_id, name, kind, price_per_kg, created_at, updated_at)
      VALUES ${sql.join(values, sql`, `)}
    `);
  }

  return jsonResponse({ ok: true });
});
