# Kitchen Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An old Android phone paired by a one-time QR code shows, view-only, the print sheet of every coming day in one long scroll, refreshing only after something is saved.

**Architecture:**
- **Write hook.** The neon client under drizzle is wrapped, so every successful write marks a Next.js cache tag stale.
- **Saved copy.** `/kitchen` renders from an `unstable_cache` copy of the day sheets, built with the print view's own `buildPrintSheet`.
- **Polling.** A small client component asks `/api/kitchen/state` every 30 s for the copy's stamp, and calls `router.refresh()` only when it changes.
- **Pairing.** A single-use code (hash stored on `groups`) is traded for a 400-day signed cookie bound to the group's key version. Bumping the version disconnects every screen.

**Tech Stack:** Next.js 16.2 App Router (no `cacheComponents`), drizzle-orm 0.45 neon-http, @neondatabase/serverless 1.0, `qrcode.react` 4.2 (new), plain CSS strings for the sheet.

**Spec:** `docs/superpowers/specs/2026-10-30-kitchen-screen-design.md`

## Global Constraints

**Package manager and gate**
- pnpm only. Never `npm install` or `npm run build` (it migrates prod), and never `db:*`.
- Gate: `npx tsc --noEmit`, `pnpm lint`, `node_modules/.bin/next build`.

**The owner's data and secrets**
- Never touch the owner's database. `DATABASE_URL` in `.env.local` is production.
- Tests use the PGlite harness or fakes.
- A local `next start` runs only with `DATABASE_URL=postgresql://nobody:x@127.0.0.1:1/none TELEGRAM_BOT_TOKEN=test-token DISABLE_OUTBOUND=1`. Env vars on the command line override `.env.local`.
- The repo is PUBLIC: no real names, phones or ids in code, fixtures, screenshots or commits. Use placeholders like `לקוח א`, `050-0000000`.

**Copy and dates**
- New user-facing strings go into `src/lib/i18n.ts` as `kitchen.*` keys, read with `t()` or `useT()`. Moved print parts keep their existing inline Hebrew.
- "Today" is `israelTodayStr()`. Times shown are 24h `HH:MM`, `Asia/Jerusalem`.

**Logging**
- Every caught failure logs with a `[kitchen]` prefix (the write hook uses `[db]`).
- No empty catches.

**Branch and commits**
- Work on branch `kitchen-screen`, one commit per task.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CQkBxFKHQNxmwV3fjqC8tX
  ```

**Cache**
- Tag `kitchen`. Invalidate with `revalidateTag('kitchen', { expire: 0 })`.
- Copies use `revalidate: 7200` (the safety re-read).
- Key parts include `process.env.VERCEL_DEPLOYMENT_ID ?? 'local'`.

**Screen cookie and pairing**
- Cookie `kitchen_screen`: `httpOnly`, `secure`, `sameSite: 'lax'`, `path: '/'`, `maxAge` 400 days.
- Re-signed on every successful state check.
- Pairing code: 10 minutes, single use, claimed by one atomic `UPDATE … RETURNING`.
- The pairing link is a page with a POST button, so link previewers can't spend the code.
- Pair and disconnect are allowed for roles `owner` and `manager` only.
- Poll interval: 30 s.

**Scratch**
- All scratch work lives in `$S/kitchen`, where `S=/private/tmp/claude-501/-Users-razielgershoni-development-just-an-orders-manager/210db9cb-6ed2-48f7-ad91-469826ed584c/scratchpad`.
- The PGlite package is at `$S/pgtest/node_modules/@electric-sql/pglite`.
- A working harness to copy is `$S/msg/pgdb.ts` and `$S/msg/tsconfig-t7.json` (path mapping pattern).
- Run tests with `node_modules/.bin/tsx --tsconfig <cfg> <file>` from the repo root.

## Review Focus

1. **A pairing link pasted into Telegram or WhatsApp.** The chat's link previewer GETs it. The code must survive, because only the POST spends it.
   - Task 5 test: GET of the pair page never calls `claimPairing`.
2. **Midnight.** A screen left open overnight must move to the new day at the first check after 00:00 Israel time.
   - Task 3 test: the cache key and stamp change when the Israel date changes, and 21:30 UTC already maps to the next day.
3. **A failed refresh.** If `router.refresh()` fails (Wi-Fi drop), the next check must try again rather than think it is current.
   - Task 6: the client never advances its stamp itself, only from new props.
   - Covered by a fixture test of the stamp logic.
4. **The database unreachable on page load.** The kiosk must not sit on an error page forever.
   - Task 6: `error.tsx` retries every 30 s, checked with a fixture render.
5. **A disconnect while the screen is open.** The next check gets 401, and the page shows **המסך נותק**. Polling stops; no 401 spam every 30 s.
   - Task 5 test: state route 401 for an old-version cookie.
   - Task 6: the disconnected view does not mount the poller.

---

### Task 1: The write hook

**Files:**
- Create: `src/db/write-hook.ts`
- Create: `src/lib/cache-tags.ts`
- Modify: `src/db/index.ts` (the `neon(...)` line inside `getDb`)
- Modify: `AGENTS.md` (one bullet under "Working in this repo")
- Test: `$S/kitchen/t1-write-hook.test.ts`, `$S/kitchen/tsconfig-t1.json`

**Interfaces:**
- Produces:
  - `isWriteSql(text: string): boolean`
  - `instrumentClient<C extends object>(client: C, onWrite: () => void): C`
  - `DATA_TAG = 'kitchen'`
  - `markDataChanged(): void`

- [ ] **Step 0: Branch.** Run `git checkout -b kitchen-screen` (the controller does this before Task 1).

- [ ] **Step 1: Write the failing test.** `$S/kitchen/tsconfig-t1.json`:

```json
{ "compilerOptions": { "target": "ES2022", "module": "commonjs", "moduleResolution": "node", "esModuleInterop": true, "strict": false, "skipLibCheck": true, "baseUrl": ".",
  "paths": { "@/*": ["/Users/razielgershoni/development/just-an-orders-manager/src/*"],
             "drizzle-orm": ["/Users/razielgershoni/development/just-an-orders-manager/node_modules/drizzle-orm"],
             "drizzle-orm/*": ["/Users/razielgershoni/development/just-an-orders-manager/node_modules/drizzle-orm/*"],
             "@neondatabase/serverless": ["/Users/razielgershoni/development/just-an-orders-manager/node_modules/@neondatabase/serverless"] } } }
```

`$S/kitchen/t1-write-hook.test.ts`:
- It drives the **real** neon client and the real drizzle `neon-http` driver, with a fake `fetch` installed through `neonConfig.fetchFunction`.
- Before finishing the fake responses, read `node_modules/@neondatabase/serverless/index.mjs`. Find what the HTTP response JSON must look like:
  - a single query: `{ fields, command, rowCount, rows, rowAsArray }`;
  - a transaction: `{ results: [...] }`;
  - an error: a non-200 status with `{ message, code }`.
- Adjust `ok()` and `fail()` to match.

```ts
import assert from 'node:assert/strict';
import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { isWriteSql, instrumentClient } from '@/db/write-hook';

let fail = false;
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const one = { fields: [], command: 'SELECT', rowCount: 0, rows: [], rowAsArray: true };
neonConfig.fetchFunction = async (_url: string, init: { body: string }) => {
  if (fail) return new Response(JSON.stringify({ message: 'boom', code: '23505' }), { status: 400 });
  const body = JSON.parse(init.body);
  return ok(Array.isArray(body.queries) ? { results: body.queries.map(() => one) } : one);
};

async function main() {
  // 1. Text rules
  const writes = [
    'insert into "orders" ("id") values ($1)',
    'update "orders" set "status" = $1 where "orders"."id" = $2',
    'delete from "order_items" where "order_items"."order_id" = $1',
    'with d as (delete from "recipe_ingredients" where "bread_type_id" = $1) insert into "recipe_ingredients" values ($2)',
    'WITH moved AS (UPDATE "group_members" SET role = $1 RETURNING id) DELETE FROM invites WHERE id = $2',
    'insert into "users" ("telegram_id") values ($1) on conflict do nothing returning "id"',
  ];
  const reads = [
    'select "id", "updated_at", "deleted_at" from "orders" where "orders"."group_id" = $1',
    'with d as (select * from "customers") select count(*) from d',
    "select 'update x set y' as note",
    '-- delete from orders\nselect 1',
    'select "notes" from "orders" where "notes" = \'please insert into the bag\'',
    'select * from "orders" for update',
  ];
  for (const w of writes) assert.equal(isWriteSql(w), true, `write: ${w}`);
  for (const r of reads) assert.equal(isWriteSql(r), false, `read: ${r}`);

  // 2. Real client + drizzle
  let fired = 0;
  const db = drizzle({ client: instrumentClient(neon('postgresql://u:p@ep-fake-123.us-east-2.aws.neon.tech/db'), () => { fired++; }), schema });

  await db.select().from(schema.groups).where(eq(schema.groups.id, 1));
  assert.equal(fired, 0, 'select must not fire');

  await db.update(schema.groups).set({ name: 'x' }).where(eq(schema.groups.id, 1));
  assert.equal(fired, 1, 'update fires once');

  await db.insert(schema.users).values({ telegramId: '1', name: 'א' }).returning();
  assert.equal(fired, 2, 'insert … returning fires once');

  await db.execute(sql`with d as (delete from ${schema.invites} where ${schema.invites.id} = 1) select 1`);
  assert.equal(fired, 3, 'CTE write via execute fires');

  await db.execute(sql`with d as (select 1) select * from d`);
  assert.equal(fired, 3, 'read CTE does not fire');

  await db.batch([db.update(schema.groups).set({ name: 'y' }).where(eq(schema.groups.id, 1)), db.select().from(schema.groups)]);
  assert.equal(fired, 4, 'batch with a write fires exactly once');

  fail = true;
  await assert.rejects(db.update(schema.groups).set({ name: 'z' }).where(eq(schema.groups.id, 1)));
  assert.equal(fired, 4, 'failed write must not fire');
  fail = false;

  // A throwing hook must never break the query it follows.
  const db2 = drizzle({ client: instrumentClient(neon('postgresql://u:p@ep-fake-123.us-east-2.aws.neon.tech/db'), () => { throw new Error('hook'); }), schema });
  await db2.update(schema.groups).set({ name: 'w' }).where(eq(schema.groups.id, 1));

  console.log('t1 OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it and see it fail.**
  - Run: `node_modules/.bin/tsx --tsconfig $S/kitchen/tsconfig-t1.json $S/kitchen/t1-write-hook.test.ts`
  - Expected: fails with "Cannot find module '@/db/write-hook'".

- [ ] **Step 3: Implement `src/db/write-hook.ts`.**

```ts
/**
 * The one place that sees every save. Drizzle sends each statement through the
 * neon client created in ./index.ts, so wrapping that client catches builder
 * writes, CTE writes sent with db.execute, and db.batch — including writes
 * added later by code that never heard of this hook. The kitchen screen's saved
 * copy (src/lib/kitchen-sheet.ts) is marked stale from here.
 */

// Comments and quoted text are blanked first, so a note that says "insert into
// the bag" or a column called "deleted_at" can't read as a write. A false
// positive costs one extra read; a false negative leaves a screen stale.
export function isWriteSql(text: string): boolean {
  const bare = text
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
  return /\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|merge\s+into|truncate)\b/i.test(bare);
}

type ThenableQuery = {
  then: (onF?: ((v: unknown) => unknown) | null, onR?: ((e: unknown) => unknown) | null) => Promise<unknown>;
  catch: (onR?: ((e: unknown) => unknown) | null) => Promise<unknown>;
  finally: (f?: (() => void) | null) => Promise<unknown>;
};

// neon's query result is a lazy NeonQueryPromise: nothing is sent until it is
// awaited, and db.batch hands the un-awaited objects to client.transaction,
// which insists they are still NeonQueryPromise instances. So the object is
// returned as-is, with its own then/catch/finally overridden: same instance,
// and the hook runs once the request has succeeded, before the caller resumes.
function afterSuccess<Q extends object>(query: Q, onDone: () => void): Q {
  const q = query as unknown as ThenableQuery;
  const originalThen = q.then.bind(query);
  let done = false;
  q.then = (onF, onR) =>
    originalThen((value) => {
      if (!done) {
        done = true;
        onDone();
      }
      return onF ? onF(value) : value;
    }, onR);
  q.catch = (onR) => q.then(undefined, onR);
  q.finally = (f) =>
    q.then(
      (value) => {
        f?.();
        return value;
      },
      (err) => {
        f?.();
        throw err;
      }
    );
  return query;
}

export function instrumentClient<C extends object>(client: C, onWrite: () => void): C {
  const fire = (where: string) => {
    try {
      onWrite();
    } catch (err) {
      console.error(`[db] write hook failed after a ${where}:`, err);
    }
  };
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'query' && typeof value === 'function') {
        return (text: string, params?: unknown[], opts?: unknown) => {
          const query = (value as (...a: unknown[]) => object).call(target, text, params, opts);
          return isWriteSql(text) ? afterSuccess(query, () => fire('query')) : query;
        };
      }
      if (prop === 'transaction' && typeof value === 'function') {
        return async (queries: unknown, opts?: unknown) => {
          const result = await (value as (...a: unknown[]) => Promise<unknown>).call(target, queries, opts);
          // The callback form hides its statements; assume it wrote.
          const wrote = Array.isArray(queries)
            ? queries.some((q) => isWriteSql((q as { queryData?: { query?: string } })?.queryData?.query ?? ''))
            : true;
          if (wrote) fire('transaction');
          return result;
        };
      }
      return value;
    },
  });
}
```

- [ ] **Step 4: Run the test and see it pass.**
  - Run the Step 2 command. Expected: `t1 OK`.
  - If the `batch` assertion fails because neon reads the query text from a different property than `queryData.query`, read `index.mjs` near `transaction(` and fix the property path in `instrumentClient`, not in the test.

- [ ] **Step 5: Prove the test can fail.**
  1. Temporarily change `return isWriteSql(text) ? afterSuccess(...) : query;` to `return query;`.
  2. Run again. Expected: `update fires once` fails.
  3. Revert.

- [ ] **Step 6: Create `src/lib/cache-tags.ts`.**

```ts
import { revalidateTag } from 'next/cache';

/** Tag on every cached copy that must change as soon as anything is saved. */
export const DATA_TAG = 'kitchen';

/**
 * Marks every DATA_TAG copy stale; the database client calls this after each
 * successful write (src/db/write-hook.ts). Next records it only inside a
 * request — a route handler, a server action, or an after() callback (they
 * run with the request's work store) — so in a script or mid-render it
 * throws. That is logged, and the copies' two-hour safety re-read covers it.
 */
export function markDataChanged(): void {
  try {
    revalidateTag(DATA_TAG, { expire: 0 });
  } catch (err) {
    console.warn('[kitchen] could not mark the saved copy stale:', err instanceof Error ? err.message : err);
  }
}
```

- [ ] **Step 7: Wire it into `src/db/index.ts`.** Replace `const sql = neon(process.env.DATABASE_URL!);` with the following, adding the two imports at the top:

```ts
import { instrumentClient } from './write-hook';
import { markDataChanged } from '@/lib/cache-tags';
```

```ts
    // Every save passes through this client; the wrapper marks the kitchen
    // screen's saved copy stale after each successful write.
    const sql = instrumentClient(neon(process.env.DATABASE_URL!), markDataChanged);
```

- [ ] **Step 8: Add an AGENTS.md bullet** under "## Working in this repo":

```md
- All DB access goes through `src/db/index.ts`. Its client wrapper (`src/db/write-hook.ts`) marks the kitchen screen's cached copy stale after every successful write; never create another neon/drizzle client in `src`.
```

- [ ] **Step 9: Run the gate.**
  - Run: `npx tsc --noEmit && pnpm lint`. Expected: no errors.

- [ ] **Step 10: Commit.**

```bash
git add src/db/write-hook.ts src/lib/cache-tags.ts src/db/index.ts AGENTS.md
git commit -m "feat(db): mark the kitchen copy stale after every successful write" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CQkBxFKHQNxmwV3fjqC8tX"
```

---

### Task 2: Screen pairing, token and disconnect

**Files:**
- Create: `drizzle/0030_kitchen_screen.sql`
- Modify: `drizzle/meta/_journal.json` (append entry idx 30)
- Modify: `src/db/schema.ts` (`groups`: three columns after `starterWasteFactor`)
- Create: `src/lib/kitchen-screen.ts`
- Test: `$S/kitchen/pgdb.ts` (copy of `$S/msg/pgdb.ts`), `$S/kitchen/next-cache-stub.ts`, `$S/kitchen/tsconfig.json`, `$S/kitchen/t2-pairing.test.ts`

**Interfaces:**
- Consumes: `signExportToken` and `verifyExportToken` from `src/lib/export-token.ts`; `DATA_TAG` from Task 1.
- Produces:
  - `KITCHEN_COOKIE = 'kitchen_screen'`
  - `SCREEN_TOKEN_TTL_SECONDS`, `PAIR_CODE_TTL_MINUTES = 10`, `SAFETY_REVALIDATE_SECONDS = 7200`
  - `cacheEpoch(): string`
  - `startPairing(groupId: number): Promise<{ code: string; expiresAt: Date }>`
  - `claimPairing(code: string): Promise<{ groupId: number; version: number } | null>`
  - `disconnectScreens(groupId: number): Promise<void>`
  - `signScreenToken(groupId: number, version: number): string`
  - `readKeyVersion(groupId: number): Promise<number | null>`
  - `verifyScreenToken(token: string, getVersion?: (groupId: number) => Promise<number | null>): Promise<{ groupId: number; version: number } | null>`
  - `screenCookie(value: string)`, which returns the cookie options object

- [ ] **Step 1: Write the migration** `drizzle/0030_kitchen_screen.sql`:

```sql
-- Kitchen screen: a phone paired by a one-time code shows the coming print
-- sheets. The version is signed into each paired screen's cookie, so bumping it
-- disconnects them all. A pairing code is stored only as its SHA-256.
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "kitchen_key_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "kitchen_pair_code_hash" varchar(64);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "kitchen_pair_expires_at" timestamp with time zone;
```

Append this to `entries` in `drizzle/meta/_journal.json`:

```json
    {
      "idx": 30,
      "version": "7",
      "when": 1793351227000,
      "tag": "0030_kitchen_screen",
      "breakpoints": true
    }
```

- [ ] **Step 2: Add the schema columns** in `groups`, after `starterWasteFactor`:

```ts
  // Kitchen screen (src/lib/kitchen-screen.ts). The version is signed into
  // every paired screen's cookie; bumping it disconnects them all. A pairing
  // code is stored only as its SHA-256 and cleared when spent.
  kitchenKeyVersion: integer('kitchen_key_version').notNull().default(0),
  kitchenPairCodeHash: varchar('kitchen_pair_code_hash', { length: 64 }),
  kitchenPairExpiresAt: timestamp('kitchen_pair_expires_at', { withTimezone: true }),
```

- [ ] **Step 3: Write the failing test harness and test.**
  - Copy `$S/msg/pgdb.ts` to `$S/kitchen/pgdb.ts` unchanged.
  - `$S/kitchen/next-cache-stub.ts`:

```ts
export const revalidated: string[] = [];
export function unstable_cache<T extends (...a: any[]) => any>(fn: T): T { return fn; }
export function revalidateTag(tag: string) { revalidated.push(tag); }
```

  - `$S/kitchen/tsconfig.json` is a copy of `$S/msg/tsconfig-t7.json` with these `paths`, plus `"jsx": "react"`:

```json
"@/db": ["./pgdb.ts"],
"next/cache": ["./next-cache-stub.ts"],
"@/*": ["/Users/razielgershoni/development/just-an-orders-manager/src/*"],
"drizzle-orm": [".../node_modules/drizzle-orm"], "drizzle-orm/*": [".../node_modules/drizzle-orm/*"],
"date-fns": [".../node_modules/date-fns"], "date-fns/*": [".../node_modules/date-fns/*"],
"zod/v4": [".../node_modules/zod/v4"]
```

  - `...` stands for `/Users/razielgershoni/development/just-an-orders-manager`. Write the full paths.
  - `$S/kitchen/t2-pairing.test.ts`:

```ts
import assert from 'node:assert/strict';
import { pg, setup } from './pgdb';
import {
  startPairing, claimPairing, disconnectScreens, signScreenToken, verifyScreenToken, readKeyVersion,
} from '@/lib/kitchen-screen';

process.env.TELEGRAM_BOT_TOKEN = 'test-token';

async function main() {
  await setup();
  await pg.exec(`insert into users (telegram_id, name) values ('100', 'בעלים')`);
  await pg.exec(`insert into groups (name, created_by) values ('מאפייה א', 1), ('מאפייה ב', 1)`);

  const { code, expiresAt } = await startPairing(1);
  assert.ok(code.length >= 32 && expiresAt.getTime() > Date.now());
  const stored = (await pg.query(`select kitchen_pair_code_hash h from groups where id = 1`)).rows[0] as { h: string };
  assert.equal(stored.h.length, 64, 'only the hash is stored');
  assert.notEqual(stored.h, code);

  assert.equal(await claimPairing('wrong'), null, 'wrong code');
  assert.deepEqual(await claimPairing(code), { groupId: 1, version: 0 });
  assert.equal(await claimPairing(code), null, 'second claim fails');

  const second = await startPairing(1);
  const third = await startPairing(1);
  assert.equal(await claimPairing(second.code), null, 'a newer code replaces an older one');
  await pg.exec(`update groups set kitchen_pair_expires_at = now() - interval '1 minute' where id = 1`);
  assert.equal(await claimPairing(third.code), null, 'expired code fails');

  const token = signScreenToken(1, 0);
  assert.deepEqual(await verifyScreenToken(token, readKeyVersion), { groupId: 1, version: 0 });
  const [, exp, sig] = token.split('.');
  assert.equal(await verifyScreenToken(`2.${exp}.${sig}`, readKeyVersion), null, 'group swapped');
  assert.equal(await verifyScreenToken('garbage', readKeyVersion), null);
  assert.equal(await verifyScreenToken('999.1.ab', readKeyVersion), null, 'unknown group');

  await disconnectScreens(1);
  assert.equal(await readKeyVersion(1), 1);
  assert.equal(await verifyScreenToken(token, readKeyVersion), null, 'old screen is disconnected');
  assert.deepEqual(await verifyScreenToken(signScreenToken(1, 1), readKeyVersion), { groupId: 1, version: 1 });
  assert.equal(await readKeyVersion(2), 0, 'other group untouched');

  console.log('t2 OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run it and see it fail.**
  - Run: `node_modules/.bin/tsx --tsconfig $S/kitchen/tsconfig.json $S/kitchen/t2-pairing.test.ts`
  - Expected: "Cannot find module '@/lib/kitchen-screen'".

- [ ] **Step 5: Implement `src/lib/kitchen-screen.ts`.**

```ts
import { createHash, randomBytes } from 'node:crypto';
import { unstable_cache } from 'next/cache';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { groups } from '@/db/schema';
import { signExportToken, verifyExportToken } from './export-token';
import { DATA_TAG } from './cache-tags';

/**
 * The kitchen screen's access: a phone trades a one-time pairing code for a
 * long-lived signed cookie that opens /kitchen and its state check, nothing
 * else. The cookie is signed for the group's current key version, so bumping
 * the version disconnects every paired screen at once.
 */

export const KITCHEN_COOKIE = 'kitchen_screen';
/** Chrome's ceiling for a cookie's lifetime; re-signed on every check, so it never runs out in use. */
export const SCREEN_TOKEN_TTL_SECONDS = 400 * 24 * 60 * 60;
export const PAIR_CODE_TTL_MINUTES = 10;
/** The saved copies' safety re-read: covers a write the hook could not report. */
export const SAFETY_REVALIDATE_SECONDS = 2 * 60 * 60;

const purpose = (version: number) => `kitchen:${version}`;
const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

/** Part of every cache key, so a deploy never reads a copy shaped by older code. */
export function cacheEpoch(): string {
  return process.env.VERCEL_DEPLOYMENT_ID ?? 'local';
}

/** A fresh one-time code; it replaces any earlier unspent one. */
export async function startPairing(groupId: number): Promise<{ code: string; expiresAt: Date }> {
  const code = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MINUTES * 60_000);
  await db
    .update(groups)
    .set({ kitchenPairCodeHash: hashCode(code), kitchenPairExpiresAt: expiresAt })
    .where(eq(groups.id, groupId));
  return { code, expiresAt };
}

/** Spends a code. One atomic UPDATE, so two phones racing the same code can't both win. */
export async function claimPairing(code: string): Promise<{ groupId: number; version: number } | null> {
  if (!code) return null;
  const [row] = await db
    .update(groups)
    .set({ kitchenPairCodeHash: null, kitchenPairExpiresAt: null })
    .where(and(eq(groups.kitchenPairCodeHash, hashCode(code)), gt(groups.kitchenPairExpiresAt, sql`now()`)))
    .returning({ groupId: groups.id, version: groups.kitchenKeyVersion });
  return row ?? null;
}

export async function disconnectScreens(groupId: number): Promise<void> {
  await db
    .update(groups)
    .set({
      kitchenKeyVersion: sql`${groups.kitchenKeyVersion} + 1`,
      kitchenPairCodeHash: null,
      kitchenPairExpiresAt: null,
    })
    .where(eq(groups.id, groupId));
}

export function signScreenToken(groupId: number, version: number): string {
  return signExportToken(groupId, SCREEN_TOKEN_TTL_SECONDS, purpose(version));
}

export async function readKeyVersion(groupId: number): Promise<number | null> {
  const [row] = await db
    .select({ version: groups.kitchenKeyVersion })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return row ? row.version : null;
}

// Checked on every state request, so it comes from the saved copy; a
// disconnect is a write, which marks it stale like everything else.
const cachedKeyVersion = (groupId: number) =>
  unstable_cache(() => readKeyVersion(groupId), ['kitchen-key', String(groupId), cacheEpoch()], {
    tags: [DATA_TAG],
    revalidate: SAFETY_REVALIDATE_SECONDS,
  })();

/**
 * The screen a cookie belongs to, or null. The group id is read from the token
 * before its signature is checked only to learn which version to check it
 * against; verifyExportToken then rejects anything not signed for exactly that.
 */
export async function verifyScreenToken(
  token: string,
  getVersion: (groupId: number) => Promise<number | null> = cachedKeyVersion
): Promise<{ groupId: number; version: number } | null> {
  const groupId = Number(token.split('.')[0]);
  if (!Number.isInteger(groupId) || groupId <= 0) return null;
  const version = await getVersion(groupId);
  if (version === null) return null;
  return verifyExportToken(token, purpose(version)) === groupId ? { groupId, version } : null;
}

export function screenCookie(value: string) {
  return {
    name: KITCHEN_COOKIE,
    value,
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SCREEN_TOKEN_TTL_SECONDS,
  };
}
```

- [ ] **Step 6: Run the test and see it pass.**
  - Run the Step 4 command. Expected: `t2 OK`, which also proves migration 0030 applies cleanly after 0029.

- [ ] **Step 7: Prove the test can fail.**
  1. Temporarily drop `gt(groups.kitchenPairExpiresAt, sql\`now()\`)` from `claimPairing`.
  2. Run again. Expected: "expired code fails".
  3. Revert.

- [ ] **Step 8: Run the gate.**
  - Run: `npx tsc --noEmit && pnpm lint`.

- [ ] **Step 9: Commit.**
  - Message: `feat(kitchen): pair a screen with a one-time code, disconnect by version`
  - Include the trailers, staging the migration, journal, schema and `src/lib/kitchen-screen.ts`.

---

### Task 3: The kitchen data (day sheets, saved copy)

**Files:**
- Modify: `src/lib/print-sheet.ts:135-168` (`buildPrintSheet` gains `opts`; add `isNull` to the drizzle import)
- Create: `src/lib/kitchen-sheet.ts`
- Test: `$S/kitchen/t3-kitchen-sheet.test.ts`

**Interfaces:**
- Consumes:
  - `buildPrintSheet(groupId, date, opts?: { undatedOnly?: boolean })` and `PrintSheet` from print-sheet;
  - `israelTodayStr` and `addDaysStr` from date-utils;
  - `DATA_TAG`, `cacheEpoch` and `SAFETY_REVALIDATE_SECONDS`.
- Produces:
  - `type KitchenDayKind = 'asap' | 'today' | 'tomorrow' | 'later'`
  - `interface KitchenDay { key: string; kind: KitchenDayKind; date: string | null; sheet: PrintSheet }`
  - `interface KitchenData { today: string; builtAt: string; days: KitchenDay[] }`
  - `loadKitchenData(groupId: number, today: string): Promise<KitchenData>`
  - `getKitchenData(groupId: number, now?: Date): Promise<KitchenData>`
  - `kitchenStamp(data: KitchenData): string`
  - `kitchenCacheKey(groupId: number, now?: Date): string[]`

- [ ] **Step 1: Write the failing test** `$S/kitchen/t3-kitchen-sheet.test.ts`.
  - Seed with SQL through `pg.exec`, reading `src/db/schema.ts` for required columns. Use placeholder names only.
  - Seed **one** bread type with one size and price, so `calculateOrderTotal` works, and give each order one `order_items` row.
  - Orders, all in group 1 unless stated:
    - A: yesterday, `confirmed`;
    - B: today, `confirmed`;
    - C: today, `delivered`;
    - D: today, `cancelled`;
    - E: tomorrow, `pending`;
    - F: today+5, `ready`;
    - G: no date, `confirmed`;
    - H: no date, `delivered`;
    - I: group 2, today, `confirmed`.
  - Compute `today` with `israelTodayStr()` and the other dates with `addDaysStr`.

```ts
import assert from 'node:assert/strict';
import { pg, setup } from './pgdb';
import { loadKitchenData, kitchenCacheKey, kitchenStamp } from '@/lib/kitchen-sheet';
import { buildPrintSheet } from '@/lib/print-sheet';
import { addDaysStr, israelTodayStr } from '@/lib/date-utils';

async function main() {
  await setup();
  const today = israelTodayStr();
  // ... seed users, groups (2), customers, bread type/size/price, orders A–I with one item each ...

  const data = await loadKitchenData(1, today);
  assert.deepEqual(data.days.map((d) => d.kind), ['asap', 'today', 'tomorrow', 'later']);
  assert.deepEqual(data.days.map((d) => d.date), [null, today, addDaysStr(today, 1), addDaysStr(today, 5)]);
  const ids = (k: number) => data.days[k].sheet.orders.map((o) => o.customerName).sort();
  assert.deepEqual(ids(0), ['לקוח G'], 'asap = open undated only');
  assert.deepEqual(ids(1), ['לקוח B', 'לקוח C'], 'today keeps delivered, drops cancelled and other groups');
  assert.equal(data.days[1].sheet.orders.find((o) => o.customerName === 'לקוח C')!.status, 'delivered');
  assert.ok(!data.days.some((d) => d.date === addDaysStr(today, -1)), 'past days left out');
  assert.equal(data.days[0].sheet.recipes.length, 0, 'asap group has no mixing weights');

  // Today always shows, even empty; no asap group when there is none.
  await pg.exec(`delete from order_items; delete from orders`);
  const empty = await loadKitchenData(1, today);
  assert.deepEqual(empty.days.map((d) => d.kind), ['today']);
  assert.equal(empty.days[0].sheet.orders.length, 0);

  // Print behaviour unchanged: the active sheet still mixes dated and undated.
  // (Re-seed one dated + one undated open order, then:)
  const active = await buildPrintSheet(1, null);
  assert.equal(active.orders.length, 2);

  // Midnight: Israel is UTC+2 on 30 Oct 2026 (DST ended 25 Oct), so 22:01Z is
  // already the next Israel day; key and stamp move.
  const before = kitchenCacheKey(1, new Date('2026-10-30T21:59:00Z'));
  const after = kitchenCacheKey(1, new Date('2026-10-30T22:01:00Z'));
  assert.equal(before[2], '2026-10-30'); assert.equal(after[2], '2026-10-31');
  assert.notDeepEqual(before, after);
  assert.notEqual(kitchenStamp({ ...data, today: '2026-10-30' }), kitchenStamp({ ...data, today: '2026-10-31' }));

  console.log('t3 OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

  - Write out the seeding block fully; don't leave the `// ...` in the real file.
  - Check the midnight dates against the Israel offset for that date. 30 Oct 2026 is after the DST change (Israel returns to UTC+2 on the last Sunday of October, 25 Oct 2026), so midnight Israel is 22:00 UTC. Pick `21:59Z` and `22:01Z`, and confirm by printing `israelTodayStr()` for both.

- [ ] **Step 2: Run it and see it fail.**
  - Run: `node_modules/.bin/tsx --tsconfig $S/kitchen/tsconfig.json $S/kitchen/t3-kitchen-sheet.test.ts`
  - Expected: "Cannot find module '@/lib/kitchen-sheet'".

- [ ] **Step 3: Add the undated mode to `buildPrintSheet`.**
  - Signature: `export async function buildPrintSheet(groupId: number, date: string | null, opts: { undatedOnly?: boolean } = {}): Promise<PrintSheet>`.
  - The `date` branch of the `where` is unchanged. The null branch becomes:

```ts
        : and(
            eq(orders.groupId, groupId),
            notInArray(orders.status, ['delivered', 'cancelled']),
            // The kitchen screen's בהקדם group: open orders with no date at all.
            opts.undatedOnly ? isNull(orders.deliveryDate) : undefined
          )
```

- [ ] **Step 4: Implement `src/lib/kitchen-sheet.ts`.**

```ts
import { unstable_cache } from 'next/cache';
import { and, asc, eq, gte, ne } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { buildPrintSheet, type PrintSheet } from './print-sheet';
import { addDaysStr, israelTodayStr } from './date-utils';
import { DATA_TAG } from './cache-tags';
import { cacheEpoch, SAFETY_REVALIDATE_SECONDS } from './kitchen-screen';

/**
 * What the kitchen screen shows: the print sheet of every coming day, built by
 * buildPrintSheet itself so the screen and a printout can never disagree.
 * בהקדם first, then today (always, even empty, so tomorrow can't pass for
 * today), then every later day that has orders. Past days are left out.
 */

export type KitchenDayKind = 'asap' | 'today' | 'tomorrow' | 'later';
export interface KitchenDay {
  key: string;
  kind: KitchenDayKind;
  date: string | null;
  sheet: PrintSheet;
}
export interface KitchenData {
  today: string;
  builtAt: string;
  days: KitchenDay[];
}

export async function loadKitchenData(groupId: number, today: string): Promise<KitchenData> {
  const dated = await db
    .selectDistinct({ date: orders.deliveryDate })
    .from(orders)
    .where(and(eq(orders.groupId, groupId), gte(orders.deliveryDate, today), ne(orders.status, 'cancelled')))
    .orderBy(asc(orders.deliveryDate));
  const dates = [today, ...dated.map((r) => r.date).filter((d): d is string => !!d && d !== today)];
  const tomorrow = addDaysStr(today, 1);

  const [asap, ...sheets] = await Promise.all([
    buildPrintSheet(groupId, null, { undatedOnly: true }),
    ...dates.map((d) => buildPrintSheet(groupId, d)),
  ]);

  const days: KitchenDay[] = [];
  if (asap.orders.length > 0) days.push({ key: 'asap', kind: 'asap', date: null, sheet: asap });
  dates.forEach((date, i) =>
    days.push({
      key: date,
      kind: date === today ? 'today' : date === tomorrow ? 'tomorrow' : 'later',
      date,
      sheet: sheets[i],
    })
  );
  return { today, builtAt: new Date().toISOString(), days };
}

/** The Israel date is in the key, so the first check after midnight builds the new day. */
export function kitchenCacheKey(groupId: number, now: Date = new Date()): string[] {
  return ['kitchen-sheet', String(groupId), israelTodayStr(now), cacheEpoch()];
}

/** The saved copy; read again only after a save (or the two-hour safety re-read). */
export function getKitchenData(groupId: number, now: Date = new Date()): Promise<KitchenData> {
  const today = israelTodayStr(now);
  return unstable_cache(() => loadKitchenData(groupId, today), kitchenCacheKey(groupId, now), {
    tags: [DATA_TAG],
    revalidate: SAFETY_REVALIDATE_SECONDS,
  })();
}

export function kitchenStamp(data: KitchenData): string {
  return `${data.today}|${data.builtAt}`;
}
```

- [ ] **Step 5: Run the test and see it pass.**
  - Run the Step 2 command. Expected: `t3 OK`.

- [ ] **Step 6: Prove the test can fail.**
  1. Temporarily remove `opts.undatedOnly ? isNull(...) : undefined`.
  2. Run again. Expected: the asap assertion fails, because dated orders leak in.
  3. Revert.

- [ ] **Step 7: Run the gate.**
  - Run: `npx tsc --noEmit && pnpm lint`.

- [ ] **Step 8: Commit.**
  - Message: `feat(kitchen): every coming day's print sheet, kept as a saved copy`

---

### Task 4: Shared print-sheet parts (pure move, output byte-identical)

**Files:**
- Create: `src/components/print/SheetParts.tsx`
- Modify: `src/app/print/orders/page.tsx`. Remove `grams`, `MixSection`, `RecipeCard`, `OrderBlock`, `STATUS_STAMP` and the inline bake `<section>`, and import them instead.
- Test: `$S/kitchen/t4-print-markup.test.tsx`, `$S/kitchen/print-sheet-stub.ts`, `$S/kitchen/export-token-stub.ts`, `$S/kitchen/react-shim.ts`, `$S/kitchen/tsconfig-t4.json`

**Interfaces:**
- Produces, from `src/components/print/SheetParts.tsx`:
  - `grams(g: number): string`
  - `STATUS_STAMP: Record<string, string>`
  - `MixSection({ sheet, idPrefix }: { sheet: PrintSheet; idPrefix?: string })`
  - `RecipeCard({ recipe }: { recipe: PrintRecipeBlock })`
  - `BakeSection({ sheet, idPrefix }: { sheet: PrintSheet; idPrefix?: string })`
  - `OrderBlock({ order, showDate }: { order: PrintOrder; showDate: boolean })`
- `idPrefix` defaults to `''`, so the print page's ids (`mix-h`, `bake-h`) are unchanged.

- [ ] **Step 1: Capture the current markup.**
  - `print-sheet-stub.ts`:
    - re-exports the types from the real module (`export type * from '/Users/.../src/lib/print-sheet'`);
    - exports `resolveRange` returning `{ date: '2026-10-30', preset: 'today' }`, or `{ date: null, preset: 'active' }` when given `'active'`;
    - exports `buildPrintSheet` returning a fixed fixture `PrintSheet`.
  - The fixture covers:
    - two recipes, one with a labelled group of two lines (so `totalGrams` is set) and one with an unlabelled single line;
    - `noRecipe` and `partialRecipe` non-empty;
    - three production lines;
    - four orders: paid pickup with a phone, unpaid delivery with address, notes and status `ready`, `delivered`, and `pending` with no phone.
    - On the active fixture, one order has `deliveryDate: null`.
  - Placeholder names only.
  - `export-token-stub.ts` exports `verifyExportToken = () => 1`.
  - `react-shim.ts` sets `globalThis.React = require('/Users/.../node_modules/react')`.
  - `tsconfig-t4.json` maps:
    - `@/lib/print-sheet` → the stub;
    - `@/lib/export-token` → the stub;
    - `@/*` → repo src;
    - `react`, `react-dom/server`, `date-fns`, `date-fns/*` → repo node_modules.

`t4-print-markup.test.tsx`:

```tsx
import './react-shim';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import PrintOrdersPage from '@/app/print/orders/page';

async function render(d: string) {
  const el = await PrintOrdersPage({ searchParams: Promise.resolve({ token: 't', d }) });
  return renderToStaticMarkup(el);
}
async function main() {
  const out = `${__dirname}/print-${process.argv[2]}.html`;
  writeFileSync(out, (await render('2026-10-30')) + '\n<!--active-->\n' + (await render('active')));
  if (process.argv[2] === 'after') {
    const a = readFileSync(`${__dirname}/print-before.html`, 'utf8');
    const b = readFileSync(out, 'utf8');
    if (a !== b) { console.error('MARKUP CHANGED'); process.exit(1); }
    console.log('t4 OK: byte-identical');
  } else console.log('captured', out, existsSync(out));
}
main().catch((e) => { console.error(e); process.exit(1); });
```

  - Run: `node_modules/.bin/tsx --tsconfig $S/kitchen/tsconfig-t4.json $S/kitchen/t4-print-markup.test.tsx before`
  - Expected: `captured …`. Check that `print-before.html` contains the recipe, bake and order markup.

- [ ] **Step 2: Move the code.**
  - Create `SheetParts.tsx` with exactly the moved functions and their comments, unchanged except:
    - `export` on each;
    - `idPrefix` on `MixSection` and the new `BakeSection` (`id={\`${idPrefix}mix-h\`}`, `aria-labelledby` likewise);
    - imports of the print-sheet types and `formatWeekdayShort`.
  - `BakeSection` is the page's inline `<section className="bake" …>` block, verbatim.
  - In `page.tsx`, replace the inline block with `<BakeSection sheet={sheet} />`.

- [ ] **Step 3: Compare.**
  - Run the Step 1 command with `after`. Expected: `t4 OK: byte-identical`.
  - Then temporarily change `לאפייה` in `BakeSection` to prove a diff fails, and revert.

- [ ] **Step 4: Run the gate and commit.**
  - Run: `npx tsc --noEmit && pnpm lint`.
  - Commit message: `refactor(print): share the sheet parts (print output unchanged)`.

---

### Task 5: Pairing page, pairing POST, state check, manifest, icons, strings

**Files:**
- Modify: `src/lib/i18n.ts`. Add the `kitchen.*` keys below, before the closing `};`.
- Create:
  - `src/app/kitchen/pair/page.tsx`
  - `src/app/api/kitchen/pair/route.ts`
  - `src/app/api/kitchen/state/route.ts`
  - `src/app/kitchen/manifest.webmanifest/route.ts`
  - `src/app/kitchen/icon/[size]/route.ts`
- Test: `$S/kitchen/t5-routes.test.ts`, `$S/kitchen/kitchen-sheet-stub.ts`, plus `tsconfig-t5.json`:
  - It is `tsconfig.json` plus a mapping of `@/lib/kitchen-sheet` to the stub, and `next/server` and `next/navigation` to the repo's real `node_modules/next/server.js` and `navigation.js`.
  - `@/db` stays PGlite.

**Interfaces:**
- Consumes Tasks 2 and 3 exports.
- Produces:
  - `POST /api/kitchen/pair` (form field `code`): it returns a 303 to `/kitchen` with the cookie, or a 303 to `/kitchen/pair?error=expired`.
  - `GET /api/kitchen/state`: it returns 200 `{ stamp }` and renews the cookie, 401 `{ error: 'disconnected' }`, or 500 `{ error: 'unavailable' }`.

- [ ] **Step 1: Add the strings to `src/lib/i18n.ts`.**

```ts
  // Kitchen screen
  'kitchen.app_name': 'מטבח',
  'kitchen.asap': 'בהקדם',
  'kitchen.today': 'היום',
  'kitchen.tomorrow': 'מחר',
  'kitchen.no_orders_today': 'אין הזמנות להיום',
  'kitchen.orders_one': 'הזמנה אחת',
  'kitchen.orders_many': '{n} הזמנות',
  'kitchen.items_one': 'פריט אחד',
  'kitchen.items_many': '{n} פריטים',
  'kitchen.updated_at': 'עודכן {time}',
  'kitchen.offline': 'אין חיבור · עודכן לאחרונה {time}',
  'kitchen.not_connected_title': 'המסך לא מחובר',
  'kitchen.disconnected_title': 'המסך נותק',
  'kitchen.connect_steps': 'כדי לחבר: באפליקציה, הגדרות ← מסך מטבח ← חבר מסך, וסורקים את הקוד במצלמה של הטלפון הזה.',
  'kitchen.load_failed': 'לא הצלחנו לטעון את ההזמנות. מנסים שוב…',
  'kitchen.pair_title': 'חיבור מסך המטבח',
  'kitchen.pair_body': 'הטלפון הזה יציג את גיליונות ההזמנות של היום והימים הבאים ויתעדכן לבד. אי אפשר לשנות ממנו שום דבר.',
  'kitchen.pair_button': 'חבר את המסך הזה',
  'kitchen.pair_expired': 'הקוד פג או כבר נוצל. צרו קוד חדש באפליקציה: הגדרות ← מסך מטבח ← חבר מסך.',
  'kitchen.settings_title': 'מסך מטבח',
  'kitchen.settings_hint': 'טלפון במטבח שמציג את ההזמנות של היום והימים הבאים ומתעדכן לבד. לצפייה בלבד.',
  'kitchen.connect': 'חבר מסך',
  'kitchen.valid_until': 'סורקים במצלמה של הטלפון במטבח. הקוד תקף עד {time}, לשימוש אחד.',
  'kitchen.disconnect': 'נתק מסכים',
  'kitchen.disconnect_confirm': 'לנתק את כל מסכי המטבח? כדי לחבר שוב צריך קוד חדש.',
  'kitchen.disconnected_done': 'המסכים נותקו',
  'kitchen.connect_failed': 'יצירת הקוד נכשלה',
  'kitchen.disconnect_failed': 'הניתוק נכשל',
```

- [ ] **Step 2: Write the failing test** `$S/kitchen/t5-routes.test.ts`.
  - `kitchen-sheet-stub.ts` exports:
    - `getKitchenData = async () => ({ today: '2026-10-30', builtAt: '2026-10-30T08:00:00.000Z', days: [] })`;
    - `kitchenStamp = (d) => \`${d.today}|${d.builtAt}\``.
  - It also exports a `failNext` flag that makes `getKitchenData` throw once.

```ts
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { pg, setup } from './pgdb';
import { startPairing, signScreenToken, disconnectScreens } from '@/lib/kitchen-screen';
import * as sheetStub from './kitchen-sheet-stub';
import { POST as pair } from '@/app/api/kitchen/pair/route';
import { GET as state } from '@/app/api/kitchen/state/route';
import * as claimSpy from '@/lib/kitchen-screen';

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
const base = 'https://example.test';

function form(code: string) {
  return new NextRequest(`${base}/api/kitchen/pair`, { method: 'POST', body: new URLSearchParams({ code }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
}
const withCookie = (v: string) => new NextRequest(`${base}/api/kitchen/state`, { headers: { cookie: `kitchen_screen=${v}` } });

async function main() {
  await setup();
  await pg.exec(`insert into users (telegram_id, name) values ('100', 'בעלים'); insert into groups (name, created_by) values ('מאפייה א', 1)`);

  const { code } = await startPairing(1);
  const ok = await pair(form(code));
  assert.equal(ok.status, 303);
  assert.equal(new URL(ok.headers.get('location')!).pathname, '/kitchen');
  const setCookie = ok.headers.get('set-cookie')!;
  assert.match(setCookie, /kitchen_screen=1\./);
  assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /Secure/i); assert.match(setCookie, /SameSite=lax/i);

  const again = await pair(form(code));
  assert.equal(new URL(again.headers.get('location')!).search, '?error=expired');
  assert.equal(again.headers.get('set-cookie'), null);

  const token = signScreenToken(1, 0);
  const s = await state(withCookie(token));
  assert.equal(s.status, 200);
  assert.deepEqual(await s.json(), { stamp: '2026-10-30|2026-10-30T08:00:00.000Z' });
  assert.match(s.headers.get('set-cookie')!, /kitchen_screen=1\./, 'cookie renewed');
  assert.equal(s.headers.get('cache-control'), 'no-store');

  assert.equal((await state(new NextRequest(`${base}/api/kitchen/state`))).status, 401, 'no cookie');
  await disconnectScreens(1);
  assert.equal((await state(withCookie(token))).status, 401, 'disconnected screen');

  sheetStub.failNext.value = true;
  assert.equal((await state(withCookie(signScreenToken(1, 1)))).status, 500, 'load failure is a 500, not a crash');

  console.log('t5 OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

  - Remove the unused `claimSpy` import if the pair-page test below doesn't need it.
  - Add a pair-**page** render check:
    1. Render `KitchenPairPage({ searchParams: Promise.resolve({ code }) })` with `renderToStaticMarkup` (react shim imported first).
    2. Assert the HTML contains `method="post"`, `action="/api/kitchen/pair"` and the code in a hidden input.
    3. Then assert the code **still claims** afterwards: `claimPairing(code)` returns non-null. That proves a GET (link preview) spends nothing.

- [ ] **Step 3: Run it and see it fail.**
  - Run: `node_modules/.bin/tsx --tsconfig $S/kitchen/tsconfig-t5.json $S/kitchen/t5-routes.test.ts`
  - Expected: module not found for the routes.

- [ ] **Step 4: Implement the pairing POST** `src/app/api/kitchen/pair/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { claimPairing, screenCookie, signScreenToken } from '@/lib/kitchen-screen';

// The pairing link opens a page with a button that posts here. Only this POST
// spends the code, so a chat app fetching the link for a preview can't use it
// up before the phone does.
export async function POST(request: NextRequest) {
  const code = String((await request.formData()).get('code') ?? '');
  const claimed = await claimPairing(code);
  if (!claimed) {
    console.warn('[kitchen] pairing code expired, already used, or wrong');
    return NextResponse.redirect(new URL('/kitchen/pair?error=expired', request.url), 303);
  }
  console.log(`[kitchen] screen paired for group ${claimed.groupId}`);
  const res = NextResponse.redirect(new URL('/kitchen', request.url), 303);
  res.cookies.set(screenCookie(signScreenToken(claimed.groupId, claimed.version)));
  return res;
}
```

- [ ] **Step 5: Implement the state check** `src/app/api/kitchen/state/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { KITCHEN_COOKIE, screenCookie, signScreenToken, verifyScreenToken } from '@/lib/kitchen-screen';
import { getKitchenData, kitchenStamp } from '@/lib/kitchen-sheet';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

// Asked every 30 s by the kitchen screen. Answered from the saved copy, so it
// never wakes the database unless something was saved since the last build.
export async function GET(request: NextRequest) {
  const token = request.cookies.get(KITCHEN_COOKIE)?.value;
  const screen = token ? await verifyScreenToken(token) : null;
  if (!screen) {
    console.warn(token ? '[kitchen] screen cookie rejected (disconnected or not ours)' : '[kitchen] state check without a screen cookie');
    return NextResponse.json({ error: 'disconnected' }, { status: 401, headers: NO_STORE });
  }
  try {
    const data = await getKitchenData(screen.groupId);
    const res = NextResponse.json({ stamp: kitchenStamp(data) }, { headers: NO_STORE });
    res.cookies.set(screenCookie(signScreenToken(screen.groupId, screen.version)));
    return res;
  } catch (err) {
    console.error(`[kitchen] state check failed for group ${screen.groupId}:`, err);
    return NextResponse.json({ error: 'unavailable' }, { status: 500, headers: NO_STORE });
  }
}
```

- [ ] **Step 6: Implement the pairing page** `src/app/kitchen/pair/page.tsx`. It is a server component, plain HTML that works with no JS, styled by the kitchen layout's CSS from Task 6. Class names: `notice`, `notice-title`, `notice-body`, `pair-btn`.

```tsx
import { t } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function KitchenPairPage({ searchParams }: { searchParams: Promise<{ code?: string; error?: string }> }) {
  const { code, error } = await searchParams;
  return (
    <main className="notice">
      <h1 className="notice-title">{t('kitchen.pair_title')}</h1>
      {error || !code ? (
        <p className="notice-body">{t('kitchen.pair_expired')}</p>
      ) : (
        <>
          <p className="notice-body">{t('kitchen.pair_body')}</p>
          <form method="post" action="/api/kitchen/pair">
            <input type="hidden" name="code" value={code} />
            <button type="submit" className="pair-btn">{t('kitchen.pair_button')}</button>
          </form>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Implement the manifest and icons.**
  - `src/app/kitchen/icon/[size]/route.ts` serves only 192 and 512, the sizes Chrome needs before **Add to Home screen** opens standalone:

```ts
import { brandIconResponse } from '@/lib/brand-icon';

export const runtime = 'nodejs';
export const revalidate = 3600;
const SIZES = new Set([192, 512]);

// The kitchen screen's home-screen icon. Chrome only opens an installed page
// full-screen when its manifest has a 192px and a 512px icon.
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response('Not found', { status: 404 });
  return brandIconResponse({ width: size, height: size });
}
```

  - `src/app/kitchen/manifest.webmanifest/route.ts`. Its colours come from the Task 6 light palette. Use `#EFEBE2`, the sheet's paper, unless Task 6 changes it.

```ts
import { t } from '@/lib/i18n';

export function GET() {
  const manifest = {
    name: t('kitchen.app_name'),
    short_name: t('kitchen.app_name'),
    start_url: '/kitchen',
    scope: '/kitchen',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#EFEBE2',
    theme_color: '#EFEBE2',
    lang: 'he',
    dir: 'rtl',
    icons: [
      { src: '/kitchen/icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/kitchen/icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' },
  });
}
```

  - Check `brandIconResponse`'s logo branch: it returns the uploaded logo as-is at its own size. Note in the report whether the logo's real pixel size can fall short of 192/512. If it can, the generated fallback mark should be used for these two sizes. Pass a flag only if that is a one-line change; otherwise report it.

- [ ] **Step 8: Run the test and see it pass.**
  - Run the Step 3 command. Expected: `t5 OK`.
  - Then temporarily delete `res.cookies.set(...)` in the state route to see "cookie renewed" fail, and revert.

- [ ] **Step 9: Run the gate and commit.**
  - Run: `npx tsc --noEmit && pnpm lint`.
  - Commit message: `feat(kitchen): pairing page, state check, home-screen manifest`.

---

### Task 6: The kitchen page, live refresh, keep-awake, look

**Files:**
- Create:
  - `src/app/kitchen/layout.tsx`
  - `src/app/kitchen/page.tsx`
  - `src/app/kitchen/error.tsx`
  - `src/app/kitchen/kitchen-css.ts`
  - `src/components/kitchen/KitchenSheets.tsx`
  - `src/components/kitchen/KitchenLive.tsx`
- Test: `$S/kitchen/t6-render.test.tsx`, fixture screenshots in `$S/kitchen/shots/`

**Interfaces:**
- Consumes:
  - Task 3's `getKitchenData`, `kitchenStamp`, `KitchenData`, `KitchenDay`;
  - Task 2's `KITCHEN_COOKIE` and `verifyScreenToken`;
  - Task 4's `MixSection`, `BakeSection`, `OrderBlock`;
  - `headingFor` from print-sheet;
  - `SHEET_CSS`.
- Produces:
  - `KitchenSheets({ data }: { data: KitchenData })`;
  - `KitchenLive({ stamp, labels }: { stamp: string; labels: { updated: string; offline: string } })`;
  - `KITCHEN_CSS: string`.

- [ ] **Step 1: Invoke the `frontend-design:frontend-design` skill**, then plan the look.
  - **Brief:** the bakery's packing sheet (`src/app/print/orders/sheet-css.ts`, read it fully) shown all day on a phone propped in a kitchen, 1–2 m away.
  - Keep the sheet's own visual language: the paper/ink tokens, the stub, mono numerals, the stamp. Add no new visual language.
  - Changes for the screen:
    - fluid width (no 190mm), 16px side gutter, no horizontal scroll;
    - base text about 18px with the quantities larger;
    - a **sticky day heading** (big, the stamp colour), so she always knows which day she is looking at;
    - the `.tick` and `.box` pencil marks hidden;
    - the freshness footer fixed at the bottom with safe-area padding, and red (`--flag`) with a boxed word when offline (the sheet's no-colour-only rule);
    - a dark palette under `@media (prefers-color-scheme: dark)` that redefines only the tokens and the `body` background, with readable contrast;
    - `.notice` and `.pair-btn` styles for the not-connected and pairing pages (a big, comfortable tap target).
  - Write it as `export const KITCHEN_CSS = \`...\`` in `kitchen-css.ts`, appended after `SHEET_CSS`.
  - Watch the specificity: override the sheet's `.sheet` rules with `.kitchen .sheet` rather than duplicating selectors.

- [ ] **Step 2: Write the layout** `src/app/kitchen/layout.tsx`:

```tsx
import type { Metadata, Viewport } from 'next';
import { SHEET_CSS } from '@/app/print/orders/sheet-css';
import { KITCHEN_CSS } from './kitchen-css';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: t('kitchen.app_name'),
  manifest: '/kitchen/manifest.webmanifest',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#EFEBE2' },
    { media: '(prefers-color-scheme: dark)', color: '<the dark ground from KITCHEN_CSS>' },
  ],
};

export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{SHEET_CSS + KITCHEN_CSS}</style>
      {children}
    </>
  );
}
```

  - Put the actual dark ground hex from Step 1 in place of `<the dark ground from KITCHEN_CSS>`.

- [ ] **Step 3: Write `src/components/kitchen/KitchenSheets.tsx`** (a server component):

```tsx
import { MixSection, BakeSection, OrderBlock } from '@/components/print/SheetParts';
import { headingFor } from '@/lib/print-sheet';
import { t } from '@/lib/i18n';
import type { KitchenData, KitchenDay } from '@/lib/kitchen-sheet';

const count = (n: number, one: string, many: string) => (n === 1 ? t(one) : t(many).replace('{n}', String(n)));

function dayTitle(day: KitchenDay): string {
  if (day.kind === 'asap') return t('kitchen.asap');
  const date = headingFor(day.date);
  if (day.kind === 'today') return `${t('kitchen.today')} · ${date}`;
  if (day.kind === 'tomorrow') return `${t('kitchen.tomorrow')} · ${date}`;
  return date;
}

function DaySheet({ day }: { day: KitchenDay }) {
  const { sheet } = day;
  const prefix = `${day.key}-`;
  return (
    <section className="sheet day" aria-labelledby={`${prefix}day-h`}>
      <header className="day-head">
        <h2 id={`${prefix}day-h`}>{dayTitle(day)}</h2>
        <span className="counts">
          {count(sheet.orders.length, 'kitchen.orders_one', 'kitchen.orders_many')} ·{' '}
          {count(sheet.totalLoaves, 'kitchen.items_one', 'kitchen.items_many')}
        </span>
      </header>
      {sheet.orders.length === 0 ? (
        <p className="empty">{t('kitchen.no_orders_today')}</p>
      ) : (
        <>
          <MixSection sheet={sheet} idPrefix={prefix} />
          <BakeSection sheet={sheet} idPrefix={prefix} />
          <section className="orders" aria-label={dayTitle(day)}>
            {sheet.orders.map((o) => (
              <OrderBlock key={o.id} order={o} showDate={false} />
            ))}
          </section>
        </>
      )}
    </section>
  );
}

export function KitchenSheets({ data }: { data: KitchenData }) {
  return (
    <main className="kitchen">
      {data.days.map((day) => (
        <DaySheet key={day.key} day={day} />
      ))}
    </main>
  );
}
```

- [ ] **Step 4: Write `src/components/kitchen/KitchenLive.tsx`.**
  - It never moves its own stamp forward; only a fresh render's prop does. So a refresh that fails is simply tried again at the next check.

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const POLL_MS = 30_000;
const clock = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' });

/**
 * Keeps the kitchen screen current and awake. Every 30 s, and at once when the
 * page is shown again or the network returns, it asks the server whether the
 * saved sheet changed; only then does it re-render the page. The stamp it
 * compares against comes from the page's own props, never set here, so a
 * refresh that fails (Wi-Fi drop) is tried again at the next check instead of
 * being taken as done.
 */
export function KitchenLive({ stamp, labels }: { stamp: string; labels: { updated: string; offline: string } }) {
  const router = useRouter();
  const stampRef = useRef(stamp);
  const [lastOk, setLastOk] = useState(() => new Date());
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    stampRef.current = stamp;
  }, [stamp]);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    async function check() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch('/api/kitchen/state', { cache: 'no-store' });
        if (res.status === 401) {
          // Disconnected from the app: the page re-renders as the disconnected
          // notice, which has no poller, so the checks stop here.
          router.refresh();
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const { stamp: next } = (await res.json()) as { stamp: string };
        setOffline(false);
        setLastOk(new Date());
        if (next !== stampRef.current) router.refresh();
      } catch (err) {
        console.warn('[kitchen] check failed:', err instanceof Error ? err.message : err);
        setOffline(true);
      } finally {
        inFlight = false;
      }
    }
    const timer = window.setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
    };
  }, [router]);

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    async function acquire() {
      if (!('wakeLock' in navigator)) {
        console.warn('[kitchen] this browser cannot keep the screen on');
        return;
      }
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.warn('[kitchen] keeping the screen on was refused:', err instanceof Error ? err.message : err);
      }
    }
    // The lock is dropped whenever the page is hidden; take it again on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch((err) => console.warn('[kitchen] releasing the screen lock failed:', err));
    };
  }, []);

  const time = clock.format(lastOk);
  return (
    <footer className={offline ? 'live live-off' : 'live'} role="status" aria-live="polite">
      {(offline ? labels.offline : labels.updated).replace('{time}', time)}
    </footer>
  );
}
```

- [ ] **Step 5: Write `src/app/kitchen/page.tsx`.**

```tsx
import { cookies } from 'next/headers';
import { KITCHEN_COOKIE, verifyScreenToken } from '@/lib/kitchen-screen';
import { getKitchenData, kitchenStamp } from '@/lib/kitchen-sheet';
import { KitchenSheets } from '@/components/kitchen/KitchenSheets';
import { KitchenLive } from '@/components/kitchen/KitchenLive';
import { t } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function KitchenPage() {
  const token = (await cookies()).get(KITCHEN_COOKIE)?.value;
  const screen = token ? await verifyScreenToken(token) : null;
  if (!screen) {
    if (token) console.warn('[kitchen] screen cookie rejected on page load');
    return (
      <main className="notice">
        <h1 className="notice-title">{t(token ? 'kitchen.disconnected_title' : 'kitchen.not_connected_title')}</h1>
        <p className="notice-body">{t('kitchen.connect_steps')}</p>
      </main>
    );
  }
  const data = await getKitchenData(screen.groupId);
  return (
    <>
      <KitchenSheets data={data} />
      <KitchenLive stamp={kitchenStamp(data)} labels={{ updated: t('kitchen.updated_at'), offline: t('kitchen.offline') }} />
    </>
  );
}
```

- [ ] **Step 6: Write `src/app/kitchen/error.tsx`.** A kiosk must recover from a failed load on its own.

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';

const RETRY_MS = 30_000;

export default function KitchenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error('[kitchen] page failed to load:', error.digest ?? error.message);
    const timer = window.setInterval(() => {
      router.refresh();
      reset();
    }, RETRY_MS);
    return () => window.clearInterval(timer);
  }, [error, reset, router]);
  return (
    <main className="notice">
      <p className="notice-body">{t('kitchen.load_failed')}</p>
    </main>
  );
}
```

- [ ] **Step 7: Render fixtures and screenshot them.** `t6-render.test.tsx`, run with `tsconfig-t4.json` plus `@/lib/kitchen-sheet` mapped to a fixture module.
  1. Build a `KitchenData` fixture with an asap day (one order), today (two orders and two recipes), tomorrow (one order) and a later day.
  2. `renderToStaticMarkup(<KitchenSheets data={fixture} />)`.
  3. Assert: no duplicate `id=` values across days; the day titles start with `בהקדם`, `היום ·`, `מחר ·`; `kitchen.*` keys are resolved, with no raw `kitchen.` text in the HTML.
  4. Write full HTML pages:
     - the sheet;
     - the not-connected notice;
     - the pair page;
     - the pair-expired page;
     - a footer in normal and offline state. Render `KitchenLive`'s footer markup statically by rendering the component; effects don't run in SSR.
  5. Each page carries `<style>` = `SHEET_CSS + KITCHEN_CSS`, and the font links and `<html class>` from a prerendered page under `.next/server/app/` after a `next build`. See the PGlite harness memory: serve with `python3 -m http.server` and symlink `_next/static`.
  6. Screenshot each at 412×915 (Galaxy A-series CSS size) in light and dark with headless Chrome:
     - `--virtual-time-budget=5000`;
     - `--force-prefers-color-scheme=dark` for dark, or `--blink-settings=preferredColorScheme=1` if the first flag is ignored.
  7. Inspect the PNGs. Fix layout issues (overflow, cramped headings, contrast) in `KITCHEN_CSS` before committing.

- [ ] **Step 8: Run the gate.**
  - Run: `npx tsc --noEmit && pnpm lint && node_modules/.bin/next build`.
  - Expected: success, with `/kitchen`, `/kitchen/pair`, `/api/kitchen/state`, `/api/kitchen/pair`, `/kitchen/manifest.webmanifest` and `/kitchen/icon/[size]` listed as dynamic (ƒ).

- [ ] **Step 9: Run a local smoke check with the database unreachable.**
  1. Run: `DATABASE_URL=postgresql://nobody:x@127.0.0.1:1/none TELEGRAM_BOT_TOKEN=test-token DISABLE_OUTBOUND=1 node_modules/.bin/next start -p 3077`, in the background.
  2. Check with curl:
     - `/kitchen` → 200, HTML has `המסך לא מחובר` and `<link rel="manifest" href="/kitchen/manifest.webmanifest"` (and **not** the root `/manifest.webmanifest`);
     - `/kitchen/manifest.webmanifest` → JSON with `start_url: "/kitchen"`;
     - `/kitchen/pair?code=abc` → 200 with the form;
     - `/api/kitchen/state` → 401.
  3. Stop the server.
  - If the root manifest link also appears, record it and make the kitchen one win: Next keeps only one `manifest` per page, and the nested value should override. Don't ship two links.

- [ ] **Step 10: Commit.**
  - Message: `feat(kitchen): the kitchen screen — every coming day, live, kept awake`.

---

### Task 7: Settings section and its API

**Files:**
- Modify: `package.json` (via `pnpm add qrcode.react@^4.2.0`)
- Create: `src/app/api/groups/[id]/kitchen/route.ts`
- Create: `src/components/settings/KitchenScreenCard.tsx`
- Modify: `src/app/miniapp/settings/page.tsx`. Render the card for `canManage` just before the Invite section.
- Test: `$S/kitchen/t7-api.test.ts` (copy the `$S/msg` `api-utils-stub.ts` pattern so `withGroup` takes a fake auth), plus a fixture screenshot.

**Interfaces:**
- Consumes `startPairing` and `disconnectScreens`.
- Produces:
  - `POST /api/groups/:id/kitchen` → `{ path: string; expiresAt: string }`;
  - `DELETE /api/groups/:id/kitchen` → `{ ok: true }`;
  - both 403 for baker or driver, and 400 when the path id ≠ `X-Group-Id`.

- [ ] **Step 1: Write the failing test.**
  - Look at `$S/msg/api-utils-stub.ts` and `t7-api.test.ts` for the harness pattern that injects `auth.memberships`.
  - Cases:
    - owner POST → 200, `path` starts `/kitchen/pair?code=`, and the stored hash matches `sha256(code)`;
    - baker POST → 403 and nothing stored;
    - driver DELETE → 403;
    - manager DELETE → 200 and the version bumped;
    - a path id of 2 with group header 1 → 400.

- [ ] **Step 2: Run it and see it fail** (module not found).

- [ ] **Step 3: Implement the route.**

```ts
import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import type { AuthContext } from '@/lib/telegram-auth';
import { disconnectScreens, startPairing } from '@/lib/kitchen-screen';

// Pairing and disconnecting the kitchen screen: owners and managers only, the
// same people who may print the sheet it shows.
function refuse(request: Request, auth: AuthContext, groupId: number): Response | null {
  const pathId = Number(new URL(request.url).pathname.split('/').at(-2));
  if (pathId !== groupId) return errorResponse('Group mismatch', 400);
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role !== 'owner' && role !== 'manager') return errorResponse('Forbidden', 403);
  return null;
}

export const POST = withGroup(async (request, auth, groupId) => {
  const refused = refuse(request, auth, groupId);
  if (refused) return refused;
  try {
    const { code, expiresAt } = await startPairing(groupId);
    console.log(`[kitchen] pairing code issued for group ${groupId}`);
    return jsonResponse({ path: `/kitchen/pair?code=${encodeURIComponent(code)}`, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    console.error(`[kitchen] issuing a pairing code failed for group ${groupId}:`, err);
    return errorResponse('Could not start pairing', 500);
  }
});

export const DELETE = withGroup(async (request, auth, groupId) => {
  const refused = refuse(request, auth, groupId);
  if (refused) return refused;
  try {
    await disconnectScreens(groupId);
    console.log(`[kitchen] screens disconnected for group ${groupId}`);
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(`[kitchen] disconnecting screens failed for group ${groupId}:`, err);
    return errorResponse('Could not disconnect', 500);
  }
});
```

- [ ] **Step 4: Run the test and see it pass.**
  - Then temporarily make `refuse` return null to see the baker case fail, and revert.

- [ ] **Step 5: Install the QR library.**
  - Run: `pnpm add qrcode.react@^4.2.0`. Expected: added to `dependencies`, and `pnpm-lock.yaml` updated.

- [ ] **Step 6: Build the card** `src/components/settings/KitchenScreenCard.tsx`.
  - Mirror the settings page's section, heading, `Card`, `Button`, copy-link and `window.confirm` patterns.
  - The QR is always black on white, with a quiet zone, so it scans in dark mode too.

```tsx
'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/hooks/useToast';
import { useT } from '@/hooks/useLang';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const clock = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' });

export function KitchenScreenCard({ groupId }: { groupId: number }) {
  const { apiFetch } = useApi();
  const toast = useToast();
  const t = useT();
  const [pairing, setPairing] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null);
  const [copied, setCopied] = useState(false);

  async function connect() {
    setBusy('connect');
    try {
      const { path, expiresAt } = await apiFetch<{ path: string; expiresAt: string }>(`/groups/${groupId}/kitchen`, { method: 'POST' });
      setPairing({ url: `${window.location.origin}${path}`, expiresAt });
    } catch (err) {
      console.error('[kitchen] pairing code request failed:', err);
      toast.error(t('kitchen.connect_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm(t('kitchen.disconnect_confirm'))) return;
    setBusy('disconnect');
    try {
      await apiFetch(`/groups/${groupId}/kitchen`, { method: 'DELETE' });
      setPairing(null);
      toast.success(t('kitchen.disconnected_done'));
    } catch (err) {
      console.error('[kitchen] disconnect request failed:', err);
      toast.error(t('kitchen.disconnect_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('[kitchen] copying the pairing link failed:', err);
    }
  }

  return (
    <section>
      <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-2">{t('kitchen.settings_title')}</h2>
      <Card>
        <p className="text-sm text-muted-foreground mb-3">{t('kitchen.settings_hint')}</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={connect} disabled={busy !== null}>{t('kitchen.connect')}</Button>
          <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy !== null}>{t('kitchen.disconnect')}</Button>
        </div>
        {pairing && (
          <div className="mt-4 flex flex-col items-center gap-3">
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={pairing.url} size={208} marginSize={2} bgColor="#ffffff" fgColor="#000000" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              {t('kitchen.valid_until').replace('{time}', clock.format(new Date(pairing.expiresAt)))}
            </p>
            <div className="w-full flex items-center gap-2 p-3 bg-muted rounded-lg">
              <span className="text-sm break-all flex-1 text-muted-foreground" dir="ltr">{pairing.url}</span>
              <Button size="icon" variant="ghost" onClick={copy}>
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
```

  - Check that `Button` supports `variant="ghost"`, `size="sm"` and `disabled`, by reading `src/components/ui/Button.tsx`, and use the variants it has.
  - The `uppercase tracking-wide` heading matches the page's existing headings. Keep it consistent.

- [ ] **Step 7: Mount the card** in `src/app/miniapp/settings/page.tsx`, just before the `{/* Invite … */}` comment:

```tsx
      {canManage && activeGroupId && <KitchenScreenCard groupId={activeGroupId} />}
```

  - Import `KitchenScreenCard` from `@/components/settings/KitchenScreenCard`.

- [ ] **Step 8: Take a fixture screenshot.**
  1. Render the card statically. Stub `useApi`, `useToast` and `useT` with tsconfig paths, and give it an initial `pairing` state. Temporarily add a `defaultPairing` prop only in the test copy, or render the inner markup.
  2. Take a 412px-wide screenshot in light and dark.
  3. Check the QR is crisp and the link wraps. A rendering check is enough; tapping is the owner's manual test.

- [ ] **Step 9: Run the gate and commit.**
  - Run: `npx tsc --noEmit && pnpm lint && node_modules/.bin/next build`.
  - Commit message: `feat(settings): connect and disconnect the kitchen screen`.

---

### Task 8: Docs, final review, merge, push (controller)

**Files:**
- Modify: `README.md`. Add a short "Kitchen screen" paragraph: what it is, connecting from Settings → מסך מטבח, Add to Home screen.
- Modify: `AGENTS.md` (Task 1's bullet already there). Add: "The kitchen screen (`/kitchen`) is view-only, cookie-paired (`src/lib/kitchen-screen.ts`), and renders `unstable_cache` copies tagged `kitchen`."
- Delete: nothing.

- [ ] **Step 1:** Write the doc lines and commit `docs: kitchen screen`.
- [ ] **Step 2:** Run one whole-branch review (Opus) against the spec and this plan's Review Focus. Fix every valid finding, each with its proving test re-run.
- [ ] **Step 3:** Run the full gate on the branch: `npx tsc --noEmit && pnpm lint && node_modules/.bin/next build`, plus re-run t1–t7.
- [ ] **Step 4:** Merge to main and push.
  - Run: `git checkout main && git merge --no-ff kitchen-screen -m "Merge kitchen screen" && git push && git branch -d kitchen-screen`.
- [ ] **Step 5:** Send the owner a push notification, and give the setup steps:
  1. Settings → מסך מטבח → חבר מסך, and scan with the kitchen phone's camera.
  2. Tap **חבר את המסך הזה**.
  3. Chrome ⋮ → Add to Home screen.
  4. Keep it charging.
  5. Optional: Settings → About phone → Software information → tap Build number 7× → Developer options → Stay awake. Samsung's Pin app is in Settings → Security and privacy → More security settings → Pin app.
  6. Manual checks: a new order appears within about 30 s; disconnect shows המסך נותק.
