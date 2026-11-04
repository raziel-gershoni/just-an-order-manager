# בהקדם Placement Switch and Kitchen Recipe Switch: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One per-bakery switch decides whether open בהקדם orders are their own group just before
today or part of today. Every view that shows orders by day follows it. A second switch shows or
hides the mixing weights on the kitchen screen.

**Architecture:**
- **Settings:** two boolean columns on `groups`.
- **Server rules:** a server-only `src/lib/asap.ts` reads the switches and owns the SQL for "today"
  and "בהקדם". The home screen, baker API, print, kitchen and Telegram use it.
- **Mini-app lists:** they apply the placement rule through `groupByDeliveryDate` in
  `src/lib/order-grouping.ts`, fed `today` and `asapInToday` by their APIs.
- **Telegram texts:** they move into `src/lib/day-digest.ts`, so the bot commands and the morning
  cron become thin callers.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM on Neon Postgres, grammy.

**Spec:** `docs/superpowers/specs/2026-11-04-asap-placement-design.md`. Read it before starting a
task.

## Global Constraints

- **Branch:** work on `asap-placement` (cut from `main`). One commit per task. Every commit message
  ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CQkBxFKHQNxmwV3fjqC8tX
  ```
- **The database:** NEVER touch it. `.env.local`'s `DATABASE_URL` is PRODUCTION. Never run
  `npm run build`, `pnpm build`, `db:*` or `scripts/migrate.ts`. pnpm only.
- **Tests:** offline scripts in `A=/private/tmp/claude-501/-Users-razielgershoni-development-just-an-orders-manager/210db9cb-6ed2-48f7-ad91-469826ed584c/scratchpad/asap`,
  run with `$A/run.sh <file> [args]`.
  - `run.sh` uses `$A/tsconfig.json`, where `@/db` is PGlite with every repo migration applied
    (`$A/pgdb.ts`, which exports `pg`, `setup()` and `db`).
  - `next/cache` is a stub, and `$A/react-shim.ts` sets `globalThis.React` for rendering
    components with `renderToStaticMarkup`.
  - Stubs a task needs (for example `@/lib/api-utils` or `@/lib/export-token`) go in a per-task
    tsconfig `$A/tsconfig-tN.json`, copied from `$A/tsconfig.json` with extra `paths`. Pass it as
    `TSX_TSCONFIG_PATH`; `run.sh` reads that env var only when it is set. Edit `run.sh` to do
    `TSX_TSCONFIG_PATH=${TSX_TSCONFIG_PATH:-$A/tsconfig.json}`. That is the first step of Task 1.
- **Gate after every task:** `npx tsc --noEmit` clean. `pnpm exec eslint .` shows 0 errors and no
  new warnings (12 existing `react-hooks/exhaustive-deps` warnings are known).
- **Final gate:** `$A/build.sh` (an offline `next build` against a fake database host) exits 0.
- **Prove every test can fail:** see it FAIL before the fix (or with the fix reverted), then PASS.
- **Strings:**
  - every user-facing string lives in `src/lib/i18n.ts` and reads as natively written Hebrew;
  - reuse existing keys: `delivery.asap` = 'בהקדם', `dash.today` = 'היום',
    `settings.save_failed`, `notify.total_today`, `notify.loaves`, `notify.no_orders_today`.
- **Dates:** server "today" = `todayStr()` from `src/lib/date-utils.ts`. Never `new Date()` or
  `format(new Date())` for a calendar day.
- **Public repo:** placeholder names only in fixtures (לקוח א, etc.). No real data.
- **Code:** no silent failures (log every caught error with a `[area]` prefix). Match the
  surrounding comment density and naming. Keep scope to the spec.
- **בהקדם order:** `delivery_date IS NULL AND status NOT IN ('delivered','cancelled')`.
  - Inside today: undated orders come first, oldest first (lowest id first).
  - Separate: the בהקדם group sits immediately before today.
  - The בהקדם group never carries mixing weights.

## Review Focus

1. **Today has no dated orders but בהקדם orders exist.**
   - On mode: today's group or section exists, holding them.
   - Off mode: the בהקדם group shows, and no "no orders today" text replaces it.
   - Tested in Tasks 2, 3, 5 and 6.
2. **History lists in on mode.** A cancelled undated order, or an old delivered undated one, never
   folds into today. It stays in a בהקדם group. Tested in Task 2.
3. **Another bakery's undated orders never appear.** Every new query carries `groupId`. Every DB
   fixture includes a group-2 undated order. Tested in Tasks 1, 3, 4, 5 and 6.
4. **Israeli midnight.** "Today" always comes from the server or the caller, never the device:
   - the baker API with no date returns `todayStr()`;
   - the grouping helper uses the `today` it is given.
   - Tested in Tasks 2 and 4.
5. **Flipping a switch while the kitchen phone is on.**
   - The loader reads the switch on every build. The settings PATCH writes through `src/db`, so
     the write hook (already tested) marks the copy stale.
   - Tested in Task 5: `loadKitchenData` before and after `update groups set ...`.

---

### Task 1: Settings columns, shared server rules, strings, PATCH

**Files:**
- Create: `drizzle/0032_order_display.sql`
- Modify: `drizzle/meta/_journal.json`: append idx 32
- Modify: `src/db/schema.ts`: the `groups` table, after `kitchenPairExpiresAt`
- Create: `src/lib/asap.ts`
- Modify: `src/app/api/groups/[id]/route.ts`: the zod schema, role gate, `updates`
- Modify: `src/lib/i18n.ts`: new keys
- Test: `$A/t1-foundation.test.ts`

**Interfaces:**
- Produces:
  - `getOrderDisplay(groupId: number): Promise<OrderDisplay>`
  - `interface OrderDisplay { asapInToday: boolean; kitchenShowRecipe: boolean }`
  - `openUndated(): SQL`
  - `todayCondition(today: string, asapInToday: boolean): SQL`
  - `undatedFirst: SQL`, a sort key that puts undated rows first; follow it with
    `asc(orders.id)`.
  - Schema fields `groups.asapInToday`, `groups.kitchenShowRecipe`.
  - PATCH body fields `asapInToday?: boolean` and `kitchenShowRecipe?: boolean`, owner or manager
    only.
  - i18n keys: `settings.asap_title`, `settings.asap_in_today`, `settings.asap_hint`,
    `kitchen.show_recipe`, `kitchen.show_recipe_hint`, `notify.total_asap`, `baker.asap_hint`.

- [ ] **Step 1: run.sh.** The branch `asap-placement` already exists and holds this plan.
  - In `$A/run.sh`, change `TSX_TSCONFIG_PATH=$A/tsconfig.json` to
    `TSX_TSCONFIG_PATH=${TSX_TSCONFIG_PATH:-$A/tsconfig.json}`.
  - Add `"next/server": ["/Users/razielgershoni/development/just-an-orders-manager/node_modules/next/server.js"]`
    to `$A/tsconfig.json` paths.

- [ ] **Step 2: Write the failing test** `$A/t1-foundation.test.ts`:

```ts
import assert from 'node:assert/strict';
import { and, asc, eq, ne } from 'drizzle-orm';
import { pg, setup, db } from './pgdb';
import { orders, groups } from '@/db/schema';
import { getOrderDisplay, todayCondition, openUndated, undatedFirst } from '@/lib/asap';
import { todayStr, addDaysStr } from '@/lib/date-utils';
import { PATCH } from '@/app/api/groups/[id]/route';
import { setAuth } from './api-utils-stub';

async function main() {
  await setup();
  const today = todayStr();
  await pg.exec(`insert into users (telegram_id, name) values ('100', 'בעלים'), ('200', 'אופה')`);
  await pg.exec(`insert into groups (name, created_by) values ('מאפייה א', 1), ('מאפייה ב', 1)`);
  await pg.exec(`insert into customers (name, group_id) values ('לקוח א', 1), ('לקוח ב', 2)`);
  // defaults after the migration
  assert.deepEqual(await getOrderDisplay(1), { asapInToday: false, kitchenShowRecipe: true });
  assert.deepEqual(await getOrderDisplay(999), { asapInToday: false, kitchenShowRecipe: true }, 'missing group → defaults');

  const add = (g: number, c: number, d: string | null, s: string) =>
    pg.query(`insert into orders (group_id, customer_id, delivery_type, delivery_date, order_status) values ($1,$2,$3,$4,$5) returning id`,
      [g, c, d ? 'specific_date' : 'asap', d, s]).then((r: any) => r.rows[0].id as number);
  const dated = await add(1, 1, today, 'confirmed');
  const undated1 = await add(1, 1, null, 'pending');
  const undated2 = await add(1, 1, null, 'confirmed');
  await add(1, 1, null, 'delivered'); // closed, never today
  await add(1, 1, null, 'cancelled');
  await add(1, 1, addDaysStr(today, 1), 'confirmed');
  await add(2, 2, null, 'confirmed'); // other bakery
  const pick = async (asapInToday: boolean) =>
    (await db.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.groupId, 1), todayCondition(today, asapInToday), ne(orders.status, 'cancelled')))
      .orderBy(undatedFirst, asc(orders.id))).map((r: any) => r.id);
  assert.deepEqual(await pick(false), [dated]);
  assert.deepEqual(await pick(true), [undated1, undated2, dated], 'undated first, by id, then dated');
  const asap = (await db.select({ id: orders.id }).from(orders).where(and(eq(orders.groupId, 1), openUndated()))).map((r: any) => r.id).sort();
  assert.deepEqual(asap, [undated1, undated2].sort());

  // PATCH: manager may flip both; baker may not
  setAuth({ memberships: [{ groupId: 1, role: 'manager' }] });
  const req = (body: unknown) => new Request('http://x/api/groups/1', { method: 'PATCH', body: JSON.stringify(body) });
  assert.equal((await PATCH(req({ asapInToday: true, kitchenShowRecipe: false }))).status, 200);
  assert.deepEqual(await getOrderDisplay(1), { asapInToday: true, kitchenShowRecipe: false });
  setAuth({ memberships: [{ groupId: 1, role: 'baker' }] });
  assert.equal((await PATCH(req({ asapInToday: false }))).status, 403);
  assert.equal((await PATCH(req({ kitchenShowRecipe: true }))).status, 403);
  assert.deepEqual(await getOrderDisplay(1), { asapInToday: true, kitchenShowRecipe: false }, 'baker changed nothing');
  console.log('t1 OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- **`$A/api-utils-stub.ts`:**
  - re-export `jsonResponse` and `errorResponse` from the real
    `/Users/razielgershoni/development/just-an-orders-manager/src/lib/api-utils.ts`;
  - export `setAuth(a)`;
  - `withAuth(h)` returns `(req) => h(req, currentAuth)`;
  - `withGroup(h)` returns `(req) => h(req, currentAuth, Number(req.headers.get('x-group-id') ?? new URL(req.url).searchParams.get('groupId') ?? 1))`.
  - Read the real `src/lib/api-utils.ts` and `src/lib/telegram-auth.ts` for the `AuthContext`
    shape, and fill the fields the routes read (at least `memberships`, `user.id`).
- **`$A/tsconfig-t1.json`:** `$A/tsconfig.json` plus
  `"@/lib/api-utils": ["./api-utils-stub.ts"]`, listed before `@/*`.
- If the PATCH route also calls `revalidatePublicSite` or other side effects, stub them in the
  same tsconfig.

- [ ] **Step 3: Run it to see it fail.** Run
  `TSX_TSCONFIG_PATH=$A/tsconfig-t1.json $A/run.sh t1-foundation.test.ts`. Expected: it FAILS,
  with a module-not-found error for `@/lib/asap`.

- [ ] **Step 4: Migration.** `drizzle/0032_order_display.sql`:

```sql
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "asap_in_today" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "kitchen_show_recipe" boolean DEFAULT true NOT NULL;
```

Append this to `drizzle/meta/_journal.json` `entries`:
`{ "idx": 32, "version": "7", "when": 1793600000000, "tag": "0032_order_display", "breakpoints": true }`.

`src/db/schema.ts`, inside `groups`, after `kitchenPairExpiresAt`:

```ts
  // Where open orders with no date (בהקדם) appear in every view that shows orders
  // by day: their own group just before today (false), or part of today (true).
  // src/lib/asap.ts reads it; the owner flips it in settings.
  asapInToday: boolean('asap_in_today').notNull().default(false),
  // Whether the kitchen screen shows each day's mixing weights (לישה).
  kitchenShowRecipe: boolean('kitchen_show_recipe').notNull().default(true),
```

- [ ] **Step 5: `src/lib/asap.ts`:**

```ts
import { and, eq, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { groups, orders } from '@/db/schema';

/**
 * Where בהקדם orders (open, no delivery date) appear. One switch per bakery
 * decides it for every view that shows orders by day: the home screen, the
 * baker tab, print, the kitchen screen and the Telegram texts read it here,
 * and the mini-app lists get it from their API (src/lib/order-grouping.ts).
 */
export interface OrderDisplay {
  asapInToday: boolean;
  kitchenShowRecipe: boolean;
}

export async function getOrderDisplay(groupId: number): Promise<OrderDisplay> {
  const [row] = await db
    .select({ asapInToday: groups.asapInToday, kitchenShowRecipe: groups.kitchenShowRecipe })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return { asapInToday: row?.asapInToday ?? false, kitchenShowRecipe: row?.kitchenShowRecipe ?? true };
}

/** A בהקדם order: still open and with no date. Delivering one stamps today's date. */
export function openUndated(): SQL {
  return and(isNull(orders.deliveryDate), notInArray(orders.status, ['delivered', 'cancelled']))!;
}

/** Today's orders; with the switch on, the בהקדם ones too. Callers add their own status rules. */
export function todayCondition(today: string, asapInToday: boolean): SQL {
  return asapInToday ? or(eq(orders.deliveryDate, today), openUndated())! : eq(orders.deliveryDate, today);
}

/** Sort key that puts undated rows first; follow it with asc(orders.id) for oldest first. */
export const undatedFirst = sql`${orders.deliveryDate} is not null`;
```

- [ ] **Step 6: PATCH.** In `src/app/api/groups/[id]/route.ts`:
  - add `asapInToday: z.boolean().optional(), kitchenShowRecipe: z.boolean().optional(),` to
    `updateGroupSchema`;
  - after the reminders gate, add:

```ts
  if ((parsed.data.asapInToday !== undefined || parsed.data.kitchenShowRecipe !== undefined) && !canManage) {
    return errorResponse('Only owner or manager can edit order display', 403);
  }
```

  - next to the reminders copy into `updates`, add:

```ts
  if (parsed.data.asapInToday !== undefined) updates.asapInToday = parsed.data.asapInToday;
  if (parsed.data.kitchenShowRecipe !== undefined) updates.kitchenShowRecipe = parsed.data.kitchenShowRecipe;
```

- [ ] **Step 7: Strings.** Put these in `src/lib/i18n.ts`, each next to its namespace's existing
  keys:

```ts
  'settings.asap_title': 'הזמנות בהקדם',
  'settings.asap_in_today': 'להציג בתוך היום',
  'settings.asap_hint': 'כבוי: הזמנות בהקדם מופיעות כקבוצה נפרדת לפני היום. דלוק: הן חלק מהיום, כולל בספירת הכיכרות ובמשקלי הלישה.',
  'kitchen.show_recipe': 'הצג מתכון',
  'kitchen.show_recipe_hint': 'משקלי הלישה של כל יום במסך המטבח. ספירת הכיכרות והשקיות מוצגות תמיד.',
  'notify.total_asap': 'סה"כ בהקדם',
  'baker.asap_hint': 'בלי משקלי לישה: להזמנות בהקדם אין יום אפייה קבוע.',
```

- [ ] **Step 8: Pass.** Run the test: it should print `t1 OK`. Then run `npx tsc --noEmit` and
  `pnpm exec eslint .`.
- [ ] **Step 9: Prove it fails.** Temporarily make `todayCondition` ignore `asapInToday`: the test
  fails. Temporarily drop the new 403 gate: the test fails. Restore both.
- [ ] **Step 10: Commit.** Message:
  `feat(settings): בהקדם placement and kitchen recipe switches (columns, rules, PATCH)`.

---

### Task 2: Placement rule in the shared grouping helper; Orders tab, customer card, deliveries

**Files:**
- Modify: `src/lib/order-grouping.ts`
- Modify: `src/app/api/orders/route.ts` (GET response)
- Modify: `src/app/api/deliveries/route.ts` (GET response)
- Modify: `src/app/miniapp/orders/page.tsx`
- Modify: `src/app/miniapp/customers/[id]/page.tsx`
- Modify: `src/app/miniapp/deliveries/page.tsx`
- Modify: `src/app/miniapp/page.tsx`: ONLY the `groupByDeliveryDate(upcomingOrders, …)` call. Pass
  `{ today: data?.today ?? '', asapInToday: false, order: 'soonest' }`. That list holds only
  tomorrow onwards. Also add `today?: string` to the `DashboardData` type. Task 3 does the rest.
- Test: `$A/t2-grouping.test.ts` (pure), `$A/t2-lists-api.test.ts` (with `tsconfig-t1.json` for
  the auth stub)

**Interfaces:**
- Consumes: `getOrderDisplay` (Task 1).
- Produces:

```ts
export interface DatedOrder { id: number; deliveryDate: string | null; status?: string; totalQuantity?: number }
export interface GroupingOptions { today: string; asapInToday: boolean; order: 'soonest' | 'latest' }
export const ASAP_GROUP_KEY = '__asap__';
export function groupByDeliveryDate<T extends DatedOrder>(orders: T[], lang: 'en' | 'he', opts: GroupingOptions): OrderGroup<T>[];
/** The items line for a row: undated rows outside the בהקדם group carry the בהקדם label first. */
export function rowItemsLine(o: { deliveryDate: string | null }, itemsSummary: string, groupKey: string, lang: 'en' | 'he'): string;
```

  `GET /api/orders` returns `{ orders, today, asapInToday }`, and `GET /api/deliveries` returns
  `{ deliveries, today, asapInToday }`. `today` is `todayStr()`.

- [ ] **Step 1: Write the failing pure test** `$A/t2-grouping.test.ts`:

```ts
import assert from 'node:assert/strict';
import { groupByDeliveryDate, rowItemsLine, ASAP_GROUP_KEY } from '@/lib/order-grouping';
const T = '2026-11-04';
const o = (id: number, d: string | null, status = 'confirmed', q = 1) => ({ id, deliveryDate: d, status, totalQuantity: q });
const keys = (g: { key: string }[]) => g.map((x) => x.key);
const ids = (g: { items: { id: number }[] }[]) => g.map((x) => x.items.map((i) => i.id));

// Soonest-first input (as the API sorts it): past-due, today, tomorrow, then undated (nulls last).
const soon = [o(1, '2026-11-03'), o(2, T), o(3, '2026-11-05'), o(9, null, 'pending', 2), o(7, null, 'confirmed', 3)];
// separate: בהקדם immediately before today, oldest (lowest id) first
let g = groupByDeliveryDate(soon, 'he', { today: T, asapInToday: false, order: 'soonest' });
assert.deepEqual(keys(g), ['2026-11-03', ASAP_GROUP_KEY, T, '2026-11-05']);
assert.deepEqual(ids(g)[1], [7, 9]);
assert.equal(g[1].label, 'בהקדם');
assert.equal(g[1].loaves, 5);
// inside today: undated first, oldest first, then today's own
g = groupByDeliveryDate(soon, 'he', { today: T, asapInToday: true, order: 'soonest' });
assert.deepEqual(keys(g), ['2026-11-03', T, '2026-11-05']);
assert.deepEqual(ids(g)[1], [7, 9, 2]);
assert.equal(g[1].loaves, 6);
// no order dated today: separate → בהקדם where today would be; inside → a today group is created there
const noToday = [o(1, '2026-11-03'), o(3, '2026-11-05'), o(7, null)];
assert.deepEqual(keys(groupByDeliveryDate(noToday, 'he', { today: T, asapInToday: false, order: 'soonest' })), ['2026-11-03', ASAP_GROUP_KEY, '2026-11-05']);
g = groupByDeliveryDate(noToday, 'he', { today: T, asapInToday: true, order: 'soonest' });
assert.deepEqual(keys(g), ['2026-11-03', T, '2026-11-05']);
assert.deepEqual(ids(g)[1], [7]);
// only undated orders
assert.deepEqual(keys(groupByDeliveryDate([o(7, null)], 'he', { today: T, asapInToday: true, order: 'soonest' })), [T]);
assert.deepEqual(keys(groupByDeliveryDate([o(7, null)], 'he', { today: T, asapInToday: false, order: 'soonest' })), [ASAP_GROUP_KEY]);
// latest-first history: … tomorrow, בהקדם, today, yesterday …; closed undated never fold into today
const late = [o(3, '2026-11-05'), o(2, T, 'delivered'), o(8, null, 'cancelled'), o(7, null), o(1, '2026-11-03', 'delivered')];
assert.deepEqual(keys(groupByDeliveryDate(late, 'he', { today: T, asapInToday: false, order: 'latest' })), ['2026-11-05', ASAP_GROUP_KEY, T, '2026-11-03']);
g = groupByDeliveryDate(late, 'he', { today: T, asapInToday: true, order: 'latest' });
assert.deepEqual(keys(g), ['2026-11-05', ASAP_GROUP_KEY, T, '2026-11-03']);
assert.deepEqual(ids(g)[1], [8], 'cancelled undated stays in בהקדם');
assert.deepEqual(ids(g)[2], [7, 2], 'open undated joins today');
// latest-first with no today group
assert.deepEqual(keys(groupByDeliveryDate([o(3, '2026-11-05'), o(7, null), o(1, '2026-11-03')], 'he', { today: T, asapInToday: false, order: 'latest' })), ['2026-11-05', ASAP_GROUP_KEY, '2026-11-03']);
// row label
assert.equal(rowItemsLine({ deliveryDate: null }, '2 כוסמין', T, 'he'), 'בהקדם · 2 כוסמין');
assert.equal(rowItemsLine({ deliveryDate: null }, '2 כוסמין', ASAP_GROUP_KEY, 'he'), '2 כוסמין');
assert.equal(rowItemsLine({ deliveryDate: T }, '2 כוסמין', T, 'he'), '2 כוסמין');
console.log('t2 grouping OK');
```

- [ ] **Step 2: Run it to see it fail.** Run `$A/run.sh t2-grouping.test.ts`. Expected: it FAILS,
  because `rowItemsLine` and `ASAP_GROUP_KEY` are not exported.

- [ ] **Step 3: Implement** in `src/lib/order-grouping.ts`. Replace `groupByDeliveryDate` and its
  doc comment, and keep `OrderGroup`. The label comes from `t('delivery.asap', lang)`
  (`import { t } from './i18n'`), never a literal.

```ts
const CLOSED = ['delivered', 'cancelled'];
const byId = <T extends { id: number }>(a: T, b: T) => a.id - b.id;

/**
 * Group orders by delivery date, keeping the input order of the dates (so an
 * API-sorted list stays sorted), each group with its label and loaf total.
 *
 * Orders with no date follow the bakery's switch (src/lib/asap.ts), oldest
 * first: with it off they form one בהקדם group just before today (where today
 * would be when nothing is dated today); with it on, the open ones lead today's
 * group instead, creating it if needed. Closed undated orders (cancelled, old
 * delivered rows) are never today, so they keep the בהקדם group either way.
 */
export function groupByDeliveryDate<T extends DatedOrder>(
  orders: T[],
  lang: 'en' | 'he',
  opts: GroupingOptions
): OrderGroup<T>[] {
  const { today, asapInToday, order } = opts;
  const dated = new Map<string, T[]>();
  const openUndated: T[] = [];
  const closedUndated: T[] = [];
  for (const o of orders) {
    if (o.deliveryDate) {
      const bucket = dated.get(o.deliveryDate);
      if (bucket) bucket.push(o);
      else dated.set(o.deliveryDate, [o]);
    } else if (o.status && CLOSED.includes(o.status)) closedUndated.push(o);
    else openUndated.push(o);
  }
  const keys = [...dated.keys()];
  // Where today sits, or would sit, in this list's reading order.
  const todayAt = () => {
    const i = keys.indexOf(today);
    if (i !== -1) return i;
    const after = keys.findIndex((k) => (order === 'soonest' ? k > today : k < today));
    return after === -1 ? keys.length : after;
  };
  const asapItems = asapInToday ? closedUndated : [...openUndated, ...closedUndated];
  if (asapInToday && openUndated.length > 0) {
    if (!dated.has(today)) keys.splice(todayAt(), 0, today);
    dated.set(today, [...openUndated.sort(byId), ...(dated.get(today) ?? [])]);
  }
  if (asapItems.length > 0) keys.splice(todayAt(), 0, ASAP_GROUP_KEY);
  return keys.map((key) => {
    const items = key === ASAP_GROUP_KEY ? asapItems.sort(byId) : dated.get(key)!;
    return {
      key,
      label: key === ASAP_GROUP_KEY ? t('delivery.asap', lang) : formatDateRelative(key, lang),
      loaves: items.reduce((sum, o) => sum + (o.totalQuantity ?? 0), 0),
      items,
    };
  });
}

/** The items line for a row: an undated order outside the בהקדם group says so first. */
export function rowItemsLine(o: { deliveryDate: string | null }, itemsSummary: string, groupKey: string, lang: 'en' | 'he'): string {
  return o.deliveryDate == null && groupKey !== ASAP_GROUP_KEY ? `${t('delivery.asap', lang)} · ${itemsSummary}` : itemsSummary;
}
```

  Note the `todayAt()` call for the בהקדם group: when today is in `keys`, the group lands
  immediately before it, which is what the spec asks for.
  Update `DatedOrder` to add `id: number` and `status?: string`.

- [ ] **Step 4: Run.** The pure test should print `t2 grouping OK`.

- [ ] **Step 5: APIs.**
  - In `src/app/api/orders/route.ts` GET:
    - before returning, add `const { asapInToday } = await getOrderDisplay(groupId);`;
    - return `jsonResponse({ orders: result, today: todayStr(), asapInToday })`;
    - imports: `getOrderDisplay` from `@/lib/asap`, and `todayStr` added to the existing
      `@/lib/date-utils` import.
  - `src/app/api/deliveries/route.ts`: the same, returning `{ deliveries, today, asapInToday }`.
  - Add `$A/t2-lists-api.test.ts`:
    - **Fixture:** group 1 has an order dated today, an open undated order and a delivery order
      with no date (`is_delivery = true`). Group 2 has an undated order.
    - **Set auth** to owner of group 1, and call the GET handlers with
      `new Request('http://x/api/orders?active=true', { headers: { 'x-group-id': '1' } })` and
      `/api/deliveries`.
    - **Assert** the response JSON has `today === todayStr()` and `asapInToday === false`.
    - **Flip the switch** (`update groups set asap_in_today = true where id = 1`) and assert
      `asapInToday === true`.
    - **Assert** no group-2 order is listed.
  - Run it with `TSX_TSCONFIG_PATH=$A/tsconfig-t1.json`. Stub further modules (for example
    `@/lib/notifications`) in that tsconfig only if they break the import.

- [ ] **Step 6: Pages.**
  - **`src/app/miniapp/orders/page.tsx`:**
    - add state `const [display, setDisplay] = useState<{ today: string; asapInToday: boolean }>({ today: '', asapInToday: false });`;
    - the fetch type is `{ orders: Order[]; today: string; asapInToday: boolean }`, followed by
      `setOrders(d.orders); setDisplay({ today: d.today, asapInToday: d.asapInToday });`;
    - the call becomes `groupByDeliveryDate(orders, lang, { ...display, order: tab === 'active' ? 'soonest' : 'latest' })`;
    - the row gets `secondary={rowItemsLine(o, o.itemsSummary, group.key, lang)}`.
  - **`src/app/miniapp/customers/[id]/page.tsx`:** the same pattern. The `/orders?customerId=`
    response gets `order: 'latest'`. The history row's `primary={o.itemsSummary}` becomes
    `primary={rowItemsLine(o, o.itemsSummary, group.key, lang)}`.
  - **`src/app/miniapp/deliveries/page.tsx`:**
    - the same pattern, with `order: 'soonest'`;
    - the `Delivery` items already carry `status`, `deliveryDate` and `id`;
    - in a group whose key is not `ASAP_GROUP_KEY`, show `t('delivery.asap')` next to the
      customer name for undated rows. Use the existing muted text style, for example a
      `<div className="text-xs text-muted-foreground">`.
  - **`src/app/miniapp/page.tsx`:** only the upcoming call, as listed under Files.

- [ ] **Step 7: Check and commit.**
  - Prove it fails: revert the `todayAt()` insertion to `keys.push(ASAP_GROUP_KEY)`, and the pure
    test fails. Restore it.
  - Run tsc and eslint.
  - Commit with message `feat(lists): בהקדם placement rule in every grouped order list`.

---

### Task 3: Home screen

**Files:**
- Modify: `src/app/api/dashboard/route.ts`
- Modify: `src/app/miniapp/page.tsx`
- Test: `$A/t3-dashboard.test.ts` (with `tsconfig-t1.json`)

**Interfaces:**
- Consumes:
  - `getOrderDisplay`, `todayCondition`, `openUndated` and `undatedFirst` (Task 1);
  - `rowItemsLine` and `ASAP_GROUP_KEY` (Task 2).
- Produces: `GET /api/dashboard` returns
  `{ today, asapInToday, todayOrders, asapOrders, upcomingOrders, pendingCount, customersWithDebt, totalPendingLoaves }`.
  - Rows in `todayOrders` and `asapOrders` carry `deliveryDate`.
  - `todayOrders` in on mode: undated open first (lowest id first), then today's dated orders by
    id.
  - `asapOrders` in off mode: open undated by id. In on mode it is `[]`.
  - `totalPendingLoaves` is the sum over `todayOrders`.

- [ ] **Step 1: Failing test `$A/t3-dashboard.test.ts`.**
  - **Fixture:** group 1 has these orders:
    - A, dated today, confirmed, quantity 1;
    - B, undated, pending, quantity 2;
    - C, undated, confirmed, quantity 3;
    - D, undated, cancelled;
    - E, dated tomorrow.
    - Group 2 has an undated order.
  - **Off mode:**
    - `todayOrders` ids are `[A]`;
    - `asapOrders` ids are `[B, C]` (lowest id first);
    - `totalPendingLoaves` is 1.
  - **On mode:**
    - `todayOrders` ids are `[B, C, A]`;
    - `asapOrders` is `[]`;
    - `totalPendingLoaves` is 6.
  - **No dated order today** (delete A), off mode: `todayOrders` is `[]` and `asapOrders` is
    `[B, C]`.
  - Every row has a `deliveryDate` key.
  - Run it and see it FAIL, since `asapOrders` is undefined.

- [ ] **Step 2: API.**
  - Replace the today query's `or(…)` with `todayCondition(today, asapInToday)`. Keep
    `eq(orders.groupId, groupId)` and `ne(orders.status, 'cancelled')`.
  - Add `deliveryDate: orders.deliveryDate` to the select, and `.orderBy(undatedFirst, asc(orders.id))`.
  - When off, run a second query, same select, with
    `where(and(eq(orders.groupId, groupId), openUndated())).orderBy(asc(orders.id))`, and enrich
    it through `enrichOrdersWithItems`. When on, `asapOrders = []`.
  - Return `today` and `asapInToday`.
  - Remove the imports that are now unused (`or`, `isNull` and `notInArray`, if nothing else
    uses them).

- [ ] **Step 3: Page** (`src/app/miniapp/page.tsx`).
  - `DashboardData`:
    - add `today: string; asapInToday: boolean; asapOrders: DashboardData['todayOrders']`;
    - add `deliveryDate: string | null` to the `todayOrders` rows.
  - `const asapOrders = data?.asapOrders ?? [];`.
  - `schedW` includes `asapOrders` ids.
  - `nothingScheduled` also requires `asapOrders.length === 0`.
  - Render the בהקדם section immediately before the "Today's Orders" block:
    `{asapOrders.length > 0 && (<><SectionHead label={t('delivery.asap')} loaves={asapOrders.reduce((s, o) => s + o.totalQuantity, 0)} /> <section …same classes as today…>{rows}</section></>)}`.
    Its rows are the same `DocketRow` props as the today rows.
  - In today's rows, `secondary={rowItemsLine(o, o.itemsSummary, data!.today, lang)}`. The group
    key here is today, so undated rows get the label.
  - The upcoming call now passes `{ today: data?.today ?? '', asapInToday: data?.asapInToday ?? false, order: 'soonest' }`.
  - The hero stays keyed on `todayOrders`.
  - Check `SectionHead` and `DocketRow` usage: same props as the existing today block, no new
    styles.

- [ ] **Step 4: Check and commit.**
  - The test should print `t3 OK`.
  - Prove it fails: make the API ignore `asapInToday`.
  - Run tsc and eslint.
  - Commit with message `feat(home): בהקדם on the home screen follows the switch`.

---

### Task 4: Baker tab

**Files:**
- Modify: `src/app/api/baker/route.ts`
- Modify: `src/app/miniapp/baker/page.tsx`
- Test: `$A/t4-baker.test.ts` (with `tsconfig-t1.json`)

**Interfaces:**
- Consumes: `getOrderDisplay`, `todayCondition` and `openUndated` (Task 1).
- Produces: `GET /api/baker[?date=]` returns
  `{ date, today, byType, unconfigured, asap: { name: string; loaves: number }[] }`.
  - With no date, `date` is `todayStr()`.
  - `asap` is filled only when `date === today` and the switch is off.
  - When `date === today` and the switch is on, `byType` includes the open undated orders.

- [ ] **Step 1: Failing test.**
  - **Fixture:**
    - bread type 'לחם א' on an order dated today (quantity 1);
    - bread type 'לחם ב' on an open undated order (quantity 2);
    - a group-2 undated order;
    - one order dated tomorrow.
  - **No date, off mode:**
    - `date === today === todayStr()`;
    - `byType` holds 'לחם א' only;
    - `asap` is `[{ name: 'לחם ב', loaves: 2 }]`.
  - **On mode:** `byType` holds both types and `asap` is `[]`.
  - **`?date=` tomorrow:** `asap` is `[]`, and `byType` holds only tomorrow's order, in either
    mode.
  - Run it and see it FAIL.

- [ ] **Step 2: API.**
  - `const today = todayStr(); const date = dateParam || today;`.
  - Where `date === today`, read `getOrderDisplay(groupId)`.
  - The ids query uses `todayCondition(date, date === today && asapInToday)` in place of
    `eq(orders.deliveryDate, date)`. Keep the group filter and `ne(cancelled)`.
  - When `date === today && !asapInToday`: select the ids for
    `and(eq(orders.groupId, groupId), openUndated())`, then
    `asap = (await aggregateRecipesForOrders(ids)).byType.map((t) => ({ name: t.name, loaves: t.totalLoaves }))`.
  - Return `{ date, today, byType, unconfigured, asap }`.

- [ ] **Step 3: Page.**
  - `date` state becomes `string | null` (null = today), so the first load sends no date.
  - `load()` fetches `` `/baker${date ? `?date=${date}` : ''}` ``.
  - The shown date is `data?.date`.
  - `shiftDate(n)` works from `data?.date ?? data?.today` with `addDays`/`format` as now.
  - The "היום" button shows when `data && data.date !== data.today`, sets `date` to `null`, and
    its text is `t('dash.today')`.
  - Remove `todayISO()`.
  - Above the `byType` cards, when `data.asap.length > 0`, render a `Card` with:
    - a title `t('delivery.asap')`;
    - the hint `t('baker.asap_hint')` in `text-xs text-muted-foreground`;
    - one line per `asap` entry, `name` with `loaves` in mono tabular numerals (mirror the
      existing per-type loaf line style).
  - Keep the `react-hooks/exhaustive-deps` disable comment exactly as it is.

- [ ] **Step 4: Check and commit.**
  - Run the test.
  - Prove it fails: make `date === today && asapInToday` always false.
  - Run tsc and eslint.
  - Commit with message `feat(baker): today's בהקדם on the baker tab, today from the server`.

---

### Task 5: Print builder, kitchen screen (+ recipe switch), print page, sheet label string

**Files:**
- Modify: `src/lib/print-sheet.ts` (`buildPrintSheet` options and where clause)
- Modify: `src/lib/kitchen-sheet.ts`
- Modify: `src/components/kitchen/KitchenSheets.tsx`
- Modify: `src/app/print/orders/page.tsx`
- Modify: `src/components/print/SheetParts.tsx`: `'בהקדם'` becomes `t('delivery.asap')`
- Modify: `docs/superpowers/specs/2026-10-30-kitchen-screen-design.md`: the "What the screen
  shows" bullets and "Code shape" now point at the switch
- Test: `$A/t5-kitchen-print.test.tsx`. It replaces `$A/t10-asap-today.test.tsx`; delete that
  file and `$A/t10-print.json`.

**Interfaces:**
- Consumes: `getOrderDisplay`, `todayCondition`, `openUndated` and `undatedFirst` (Task 1).
- Produces:
  - `buildPrintSheet(groupId, date, opts: { withUndated?: boolean; undatedOnly?: boolean })`.
  - `KitchenData` gains `showRecipe: boolean`.
  - `KitchenDayKind` is `'asap' | 'today' | 'tomorrow' | 'later'`.
  - `KitchenDay.date` is `string | null`.

- [ ] **Step 1: Failing test.** Use the fixture of the old t10, adapted: today's date comes from
  `todayStr()`, with no snapshot file.
  - **Print-sheet regression** (both modes, since the builder doesn't read the switch):
    `buildPrintSheet(1, addDaysStr(today, 1))` and `buildPrintSheet(1, null)` give the same order
    ids, in the same order, as before. Hard-code the expected id lists from the fixture.
  - **Kitchen, off (default):**
    - `days.map(kind)` is `['asap', 'today', 'tomorrow', 'later']`;
    - the asap card holds the open undated orders (oldest first), its title is 'בהקדם', and it
      has `recipes.length === 0`;
    - today holds only dated orders.
  - **Kitchen, on:** kinds are `['today', 'tomorrow', 'later']`, and today is undated first
    (oldest first), then dated.
  - **Kitchen, off, no undated orders:** no asap card.
  - **Kitchen, on, no dated order today:** today holds the undated orders.
  - **Recipe switch:**
    - with `kitchen_show_recipe = false`, `data.showRecipe === false`;
    - in a fixture with a recipe (`recipes` and `recipe_ingredients` rows for 'לחם א'; read
      `drizzle/` and `src/db/schema.ts` for the columns), `renderToStaticMarkup(<KitchenSheets data={data} />)`
      contains no `לישה` heading;
    - with true, it does contain one.
  - **Flip while running:** call `loadKitchenData` before and after
    `update groups set asap_in_today = …`; the shape changes, with no cache involved.
  - **Print page, rendered:** call `PrintOrdersPage({ searchParams: Promise.resolve({ token: 't', d: 'today' }) })`
    with `@/lib/export-token` stubbed so that `verifyExportToken` returns 1, and render the
    result.
    - Off: two `<main class="sheet"` blocks, the first headed 'בהקדם'.
    - On: one sheet, whose first bag's details line starts with 'בהקדם'.
    - `d: 'tomorrow'` in either mode: one sheet with no undated orders.
  - **Labels:** the rendered kitchen and print markup contain `בהקדם` on each undated bag and on
    no dated bag.
  - Run it and see it FAIL.

- [ ] **Step 2: `buildPrintSheet`.**
  - The options become `{ withUndated?: boolean; undatedOnly?: boolean }`.
  - Dated branch: `opts.withUndated ? todayCondition(date, true) : eq(orders.deliveryDate, date)`,
    plus the group filter and `ne(cancelled)`.
  - Date-null branch: `and(eq(orders.groupId, groupId), open, opts.undatedOnly ? isNull(orders.deliveryDate) : undefined)`.
  - Order: when `opts.withUndated || opts.undatedOnly`, use `.orderBy(undatedFirst, asc(orders.id))`.
    Every dated row on a dated sheet shares one date, so their order is unchanged: before, it was
    by id after an equal date key. Otherwise keep the existing coalesce key, then `asc(orders.id)`.
    Undated orders therefore go oldest first by order number, the same rule as the mini-app
    lists.
  - Remove the local `open` only if `openUndated()` replaces every use. The active sheet still
    needs "open" without the null check, so keep it.
  - Update the comment that explains `withUndated`.

- [ ] **Step 3: Kitchen.**
  - `loadKitchenData` reads `getOrderDisplay(groupId)`.
  - It builds `display.asapInToday ? null : buildPrintSheet(groupId, null, { undatedOnly: true })`
    alongside the per-date sheets. Pass `{ withUndated: display.asapInToday && d === today }`.
  - When off and the asap sheet has orders, unshift
    `{ key: 'asap', kind: 'asap', date: null, title: t('delivery.asap'), sheet }`.
  - Return `showRecipe: display.kitchenShowRecipe`.
  - `dayTitle` handles `'asap'`.
  - Update the module doc comment.
  - In `KitchenSheets.tsx`, `DaySheet` takes `showRecipe`, and
    `{showRecipe && <MixSection … />}`. Keep `showDate={!o.deliveryDate}`.

- [ ] **Step 4: Print page.**
  - `const isToday = date === todayStr();`
  - `const display = isToday ? await getOrderDisplay(groupId) : null;`
  - `const asapSheet = display && !display.asapInToday ? await buildPrintSheet(groupId, null, { undatedOnly: true }) : null;`
  - `const sheet = await buildPrintSheet(groupId, date, { withUndated: !!display?.asapInToday });`
  - Move the `<main className="sheet">…</main>` markup into a local
    `function Sheet({ sheet, heading }: { sheet: PrintSheet; heading: string })` component, and
    render `{asapSheet && asapSheet.orders.length > 0 && <Sheet sheet={asapSheet} heading={t('delivery.asap')} />}`
    before `<Sheet sheet={sheet} heading={sheet.heading} />`.
  - `OrderBlock` gets `showDate={!sheet.date || !o.deliveryDate}`.

- [ ] **Step 5: Label string.** In `SheetParts.tsx`, the `'בהקדם'` literal becomes
  `t('delivery.asap')` (`import { t } from '@/lib/i18n'`).

- [ ] **Step 6: Spec.** In `docs/superpowers/specs/2026-10-30-kitchen-screen-design.md`, replace
  the lines about today holding the בהקדם orders (Decisions bullet, "What the screen shows" bullet,
  "Code shape" bullet). Each one now says it follows the switch in
  `2026-11-04-asap-placement-design.md`, and that `הצג מתכון` hides the לישה section.

- [ ] **Step 7: Check and commit.**
  - Run the test.
  - Prove it fails: always pass `withUndated: false`, and the on-mode assertions fail; drop the
    `showRecipe` check, and the recipe assertion fails.
  - Run tsc and eslint.
  - Commit with message `feat(kitchen,print): בהקדם follows the switch; kitchen recipe switch`.

---

### Task 6: Telegram: /today, /week, morning baking message, new-order date line

**Files:**
- Create: `src/lib/day-digest.ts`
- Modify: `src/app/api/bot/route.ts`: the `/today` and `/week` handlers become thin
- Modify: `src/app/api/cron/morning-reminder/route.ts`: `sendBakingSummary` uses the digest
- Modify: `src/lib/notifications.ts`: `sendMorningSummary` takes sections; `notifyNewOrder` gets
  the date line
- Test: `$A/t6-digest.test.ts`

**Interfaces:**
- Consumes: `getOrderDisplay`, `todayCondition`, `openUndated` and `undatedFirst` (Task 1).
- Produces (`src/lib/day-digest.ts`, server only):

```ts
export interface BakeLine { customerName: string; breadTypeName: string; quantity: number }
/** The /today reply (HTML), or null when there is nothing today and nothing בהקדם. */
export function todayDigestText(groupId: number, today: string, lang: Lang): Promise<string | null>;
/** The /week reply (HTML), or null when there is nothing. */
export function weekDigestText(groupId: number, today: string, weekEnd: string, lang: Lang): Promise<string | null>;
/** The morning bake: today's lines (with the בהקדם ones when the switch is on), the separate בהקדם lines (off), and today's recipe block. Null when both are empty. */
export function morningBake(groupId: number, today: string): Promise<{ today: BakeLine[]; asap: BakeLine[]; recipeBlock?: string } | null>;
```

  `sendMorningSummary(groupId, bake: { today: BakeLine[]; asap: BakeLine[]; recipeBlock?: string })`.

- [ ] **Step 1: Failing test `$A/t6-digest.test.ts`.**
  - **Fixture:**
    - group 1 has a dated-today confirmed order for 'לקוח א' (2 × 'לחם א');
    - a dated-today delivered order for 'לקוח ג' (1 × 'לחם א');
    - an open undated order for 'לקוח ב' (3 × 'לחם ב');
    - a group-2 undated order;
    - an order dated tomorrow.
  - **`todayDigestText`:**
    - Off: the text contains 'בהקדם' before 'לקוח א'. The בהקדם section lists 'לקוח ב' and a
      `t('notify.total_asap')` line with 3. Today's total is 3: `/today` keeps delivered orders,
      as it does now.
    - On: one list, 'לקוח ב' first with ' · בהקדם' on its line, and today's total is 6.
    - Only undated orders exist: a text, not null. In off mode it contains
      `t('notify.no_orders_today')` under today. In on mode the today list holds them.
    - Nothing at all: null.
  - **`weekDigestText`:**
    - day headings use `formatWeekdayShort` (no `yyyy-MM-dd` match in the text).
    - Off: the בהקדם bucket comes first.
    - On: 'לקוח ב' is under today's heading.
  - **`morningBake`:**
    - Off: `asap` has the 'לקוח ב' line and `today` excludes it.
    - On: `today` includes it and `asap` is `[]`.
    - It excludes delivered orders, as the cron does now.
    - Empty: null.
  - **`sendMorningSummary`:**
    - Set `process.env.DISABLE_OUTBOUND` to `''` for this part.
    - Insert a group-1 member with role 'baker' and a `telegram_id` (read `getRecipientsByRole`
      for what it needs).
    - Intercept with `getBot().api.config.use(async (_prev, method, payload) => { sent.push({ method, payload }); return { ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: 'private' } } } as any; })`.
    - Call it with an off-mode bake. One `sendMessage` goes out, and its text has the בהקדם
      section before today's.
  - **`notifyNewOrder`** with `deliveryDate: null` puts the `notify.delivery_date` line with
    'בהקדם' in the text. Read its signature in `src/lib/notifications.ts` and capture the send in
    the same way.
  - Run it and see it FAIL (module not found).

- [ ] **Step 2: `src/lib/day-digest.ts`.** Move the query and formatting bodies of the `/today`
  and `/week` handlers here unchanged (same emoji, HTML escaping via `escapeHtml` from
  `@/lib/telegram-html`, and `getOrderItemsSummaries`). Move that helper too if it lives in the
  bot route, and export it from the new module. Then apply the switch:
  - **`/today`:**
    - The query becomes `and(eq(orders.groupId, groupId), todayCondition(today, asapInToday), ne(orders.status, 'cancelled'))`
      with ``.orderBy(undatedFirst, sql`(case when ${orders.deliveryDate} is null then ${orders.id} end) asc`, asc(customers.name))``.
      Undated rows come first, oldest first, and dated rows keep today's customer-name order.
    - In on mode, an undated row's line ends with `` ` · ${t('delivery.asap', lang)}` ``.
    - In off mode, a second query runs with `and(eq(orders.groupId, groupId), openUndated())`,
      ordered by id. It renders first as
      `<b>${t('delivery.asap', lang)}</b>`, then its lines, then
      `<b>${t('notify.total_asap', lang)}:</b> N ${t('notify.loaves', lang)}`, then a blank line,
      then `<b>${t('dash.today', lang)}</b>`.
    - After that, today's lines, or `t('notify.no_orders_today', lang)` when there are none, then
      today's total and the recipe block. The recipe block covers today's rows only, so it
      includes the undated rows in on mode.
    - Return null when there are no rows at all.
    - Drop the dead `'baking'` emoji branch, leaving `ready → ✅`, else `⏳`.
  - **`/week`:**
    - The dated query is unchanged.
    - In on mode, add the `openUndated()` rows to today's bucket, first.
    - In off mode, they form a first bucket headed `t('delivery.asap', lang)`.
    - Other headings are `formatWeekdayShort(date)`. Today's heading is
      `t('dash.today', lang) · formatWeekdayShort(today)`.
    - The recipe block covers dated ids, plus the undated ones in on mode.
    - Remove the dead `?? 'ASAP'`.
  - **`morningBake`:**
    - Move the query and line building from `sendBakingSummary`. Today's condition is
      `todayCondition(today, asapInToday)`, plus `ne(cancelled)` and `ne(delivered)`.
    - Off: a second set of lines from `openUndated()`.
    - The recipe block covers today's ids only. Keep the try/catch and `console.error` around
      `buildRecipeBlockForOrders`.
  - **`sendMorningSummary`:**
    - The existing per-type block becomes a local function.
    - With `asap` lines: `<b>${t('delivery.asap')}</b>`, the per-type block for `asap`, the line
      `<b>${t('notify.total_asap')}:</b> N ${t('notify.loaves')}`, a blank line, then
      `<b>${t('dash.today')}</b>`.
    - Then today's per-type block, or `t('notify.no_orders_today')` when there are none.
    - Then today's total, then the recipe block.
    - Return `{sent:0, failed:0}` only when both are empty.

- [ ] **Step 3: Callers.**
  - In the bot route, `/today` becomes: resolve the user and group as now, then
    `const text = await todayDigestText(groupId, todayStr(), lang); await ctx.reply(text ?? t('notify.no_orders_today', lang), text ? { parse_mode: 'HTML' } : undefined);`.
  - `/week` works the same way (with `upcomingHorizonStr()` and `bot.no_orders` as the empty
    reply).
  - In the cron, `sendBakingSummary` becomes:
    `const bake = await morningBake(groupId, today); if (!bake) { stats.skipped++; return; }`
    followed by `sendMorningSummary(groupId, bake)`, with the same stats and logging as now.
  - Remove imports that are now unused from both files.

- [ ] **Step 4: New-order date line.** In `notifyNewOrder`, after the `if (order.deliveryDate) {…}`
  block, add `else lines.push(`<b>${t('notify.delivery_date', lang)}:</b> ${t('delivery.asap', lang)}`);`.

- [ ] **Step 5: Check and commit.**
  - Run the test.
  - Prove it fails: make `todayCondition` receive `false` in `todayDigestText`.
  - Run tsc and eslint.
  - Commit with message `feat(telegram): /today, /week and the morning bake follow the בהקדם switch`.

---

### Task 7: Settings UI

**Files:**
- Modify: `src/app/miniapp/settings/page.tsx`
- Modify: `src/components/settings/KitchenScreenCard.tsx`
- Test: `$A/t7-settings-ui.test.tsx` (render with stubs)

**Interfaces:**
- Consumes:
  - the PATCH fields from Task 1;
  - the i18n keys `settings.asap_title`, `settings.asap_in_today`, `settings.asap_hint`,
    `kitchen.show_recipe` and `kitchen.show_recipe_hint`.
- Produces: `KitchenScreenCard({ groupId, initialShowRecipe }: { groupId: number; initialShowRecipe: boolean | null })`.
  `null` means not loaded yet, and the switch is disabled.

- [ ] **Step 1: Failing render test.**
  - Stub `@/hooks/useApi`, `@/hooks/useToast` and `@/hooks/useLang` through
    `$A/tsconfig-t7.json` paths, so `useT` returns the real `t` and `useApi` records calls.
  - Also map `qrcode.react` and `lucide-react` (plus their `/*` forms) to the repo's
    `node_modules`, since scratchpad bare imports don't resolve.
  - `renderToStaticMarkup(<KitchenScreenCard groupId={1} initialShowRecipe={false} />)` contains
    `role="switch"`, `aria-checked="false"` and the text 'הצג מתכון'.
  - With `true`, it contains `aria-checked="true"`.
  - With `null`, the switch has `disabled`.
  - Run it and see it FAIL.

- [ ] **Step 2: KitchenScreenCard.**
  - `const [showRecipe, setShowRecipe] = useState<boolean | null>(initialShowRecipe); useEffect(() => setShowRecipe(initialShowRecipe), [initialShowRecipe]);`.
  - `toggleRecipe(next)`: optimistic `setShowRecipe(next)`, then PATCH `/groups/${groupId}`
    `{ kitchenShowRecipe: next }`. On error: `console.error('[kitchen] recipe switch save failed:', err)`,
    revert, and `toast.error(t('settings.save_failed'))`.
  - Inside the card, above the connect buttons: a row with the label `t('kitchen.show_recipe')`
    and the same switch markup as the delivery switch (`role="switch"`, `aria-checked`,
    `disabled={showRecipe === null}`, `bg-success`/`bg-muted`, knob `start-6`/`start-1`), then
    `<p className="text-xs text-muted-foreground">{t('kitchen.show_recipe_hint')}</p>`.

- [ ] **Step 3: Settings page.**
  - Extend the GET type with `asapInToday: boolean; kitchenShowRecipe: boolean`.
  - State: `asapInToday` (`boolean | null`, null until loaded), set from `g.group.asapInToday`,
    and `kitchenShowRecipe` (`boolean | null`).
  - `toggleAsap(next)` follows the same optimistic pattern with `{ asapInToday: next }`, logging
    `[settings] asap switch save failed:`.
  - Render a new section for `canManage`, immediately before the `KitchenScreenCard` line, styled
    like the delivery section:
    - an `h2` with `t('settings.asap_title')`;
    - a `Card` holding a row with the label `t('settings.asap_in_today')` and the switch
      (disabled while null);
    - the hint `t('settings.asap_hint')` in `text-xs text-muted-foreground`.
  - Pass `initialShowRecipe={kitchenShowRecipe}` to `KitchenScreenCard`.

- [ ] **Step 4: Check and commit.**
  - Run the test.
  - Prove it fails: hard-code `aria-checked={true}`.
  - Run tsc and eslint.
  - Commit with message `feat(settings): בהקדם and kitchen recipe switches in settings`.

---

### Task 8: Docs and final gate

**Files:**
- Modify: `AGENTS.md`
- Delete: `docs/superpowers/plans/2026-11-04-asap-placement.md` (stale once shipped)

- [ ] **Step 1: AGENTS.md.** Add one bullet after the dates bullet:

```md
- בהקדם (open, undated) orders follow one per-bakery switch, `groups.asap_in_today`: their own group just before today, or part of today. Server code takes "today" and "בהקדם" only from `src/lib/asap.ts` (`todayCondition`, `openUndated`); mini-app lists group through `groupByDeliveryDate` (`src/lib/order-grouping.ts`) with the `today`/`asapInToday` their API returns. Telegram day texts live in `src/lib/day-digest.ts`.
```

- [ ] **Step 2: Run everything.**
  - Re-run t1 through t7 (each with its own tsconfig), and confirm every one prints OK.
  - Run `npx tsc --noEmit`.
  - Run `pnpm exec eslint .` (12 known warnings, no new ones).
  - Run `$A/build.sh final`, which should exit 0.
- [ ] **Step 3: Commit.** Message: `docs: AGENTS.md on the בהקדם switch; drop the shipped plan`.
