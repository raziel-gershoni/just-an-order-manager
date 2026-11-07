# Kitchen screen Shabbat mode: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From candle lighting until the end of each Shabbat or Yom Tov, the kitchen screen shows a Shabbat view (candles, greeting, occasion, Hebrew date, times) built from famcal's Jewish times API. Polling never stops.

**Architecture:**
- **One famcal client.** `src/lib/famcal.ts` uses p-retry and zod.
- **A pure builder.** `src/lib/shabbat-build.ts` turns famcal's answers into a stored timeline.
- **A pure, client-safe view module.** `src/lib/shabbat-view.ts` picks what to show at a given instant.
- **Orchestration with the database.** `src/lib/shabbat-times.ts` saves, refreshes, reads and checks coverage.
- **The rest:** a settings route and card, a morning-cron refresh with a warning, and `ShabbatScreen` rendered by `KitchenScreen` while a stretch is active.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle + Neon, zod/v4, p-retry 9, Telegram via grammy (existing helpers).

**Spec:** `docs/superpowers/specs/2026-11-08-kitchen-shabbat-mode-design.md` (read it first).

## Global Constraints

- **famcal is read-only.** Nothing outside this repo is changed. The API reference lives in famcal's `docs/api/jewish-times-v1.md`, base `https://famcal.bot/api/v1`. Every call sends exactly `city`, `community`, `lang=he` plus `from` and `to` (/shabbat) or `date` (/day). famcal answers 400 to any other parameter.
- **`FAMCAL_API_KEY` is server-only.** Never log it, never send it to the client.
- **Tests never reach famcal, Telegram or the real database.**
  - Use the harness at `H=/private/tmp/claude-501/-Users-razielgershoni-development-just-an-orders-manager/210db9cb-6ed2-48f7-ad91-469826ed584c/scratchpad/shabbat`: run with `$H/run.sh $H/<test>`, using PGlite with every migration (`$H/pgdb.ts`) and `@/lib/api-utils` stubbed by `$H/api-utils-stub.ts`. jsdom is installed in `$H/node_modules`.
  - Tests replace `globalThis.fetch`. `run.sh` unsets `DATABASE_URL` and `FAMCAL_API_KEY` and sets `DISABLE_OUTBOUND=1`. A test that needs a key sets `process.env.FAMCAL_API_KEY = 'fcj_test'` itself.
- **Never run** `pnpm build`, `npm run build`, `pnpm db:*`, `drizzle-kit` or `scripts/migrate.ts`. Those touch the production database. Verify with:
  - `npx tsc --noEmit`
  - `pnpm exec eslint <files>`
  - the offline build: `bash /private/tmp/claude-501/-Users-razielgershoni-development-just-an-orders-manager/210db9cb-6ed2-48f7-ad91-469826ed584c/scratchpad/asap/build.sh shabbat-build`
- **pnpm only.** The new dependency is `p-retry@^9.0.0` (ESM, Node ≥ 22).
- **No inline user-facing strings.** Every Hebrew string goes through `src/lib/i18n.ts` (`t()` on the server and in the kitchen screen, `useT()` in mini-app components). Exceptions: names coming from famcal (zmanim, occasion, Hebrew date, end name), famcal's English credits, and the city names in `src/lib/famcal-cities.ts`, which are famcal's own data.
- **No silent failures.** Every catch logs with a tag (`[famcal]`, `[shabbat]`, `[kitchen]`, `[cron/morning-reminder]`). No empty catch.
- **No timeouts of our own.** Retries use p-retry's backoff: `retries: 3, factor: 2, minTimeout: 1000, randomize: true`.
- **Times on screen** use Israel's clock as hh:mm, 24 h (`Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' })`). `dir="ltr"` goes on the digits only, never on Hebrew text.
- **Match the surrounding code:** its comment density, naming and idioms. Server code takes "today" only from `src/lib/date-utils.ts` (`todayStr`, `israelDateStr`, `addDaysStr`, `weekdayIndex`).
- **Commits:** one per task, on branch `feat/shabbat-mode`, ending with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CQkBxFKHQNxmwV3fjqC8tX
  ```
- **Public repo:** no real names, phones or ids in code, fixtures or commits.

## Review Focus

1. **Phone clock vs. server render.** A page rendered during Shabbat must show the Shabbat view on the first client render. `now` starts from `renderedAt`, so hydration matches, and only then follows `Date.now()`. Test it in Task 6 (SSR at a `renderedAt` inside a stretch shows the Shabbat markup).
2. **Two-day stretches** (ראש השנה, or Yom Tov into Shabbat): the Hebrew date and occasion move to day 2 after day 1's sunset. The "הדלקת נרות" row after day 1's sunset must still be listed until its time. Covered by Task 2's view tests.
3. **A refresh racing a settings change** must never leave times for a different city on the screen. That is the conditional write plus the reader's city and community check. Task 3 tests it.
4. **famcal down or the key missing at save:** nothing is written, the switch reverts, and a clear toast shows. Tested in Tasks 3, 4 and 7.
5. **Polling keeps running during Shabbat,** and the view switches back to the orders by itself at the end. Task 6's jsdom test advances a fake clock across start and end and counts the `/api/kitchen/state` calls.

---

### Task 1: Foundation: dependency, schema and migration, famcal client, city list, strings

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (via `pnpm add p-retry@^9.0.0`)
- Modify: `src/db/schema.ts` (groups columns, new `shabbatTimes` table)
- Create: `drizzle/0033_shabbat_mode.sql`; Modify: `drizzle/meta/_journal.json`
- Create: `src/lib/shabbat-view.ts` (types only in this task; the functions come in Task 2)
- Create: `src/lib/famcal.ts`
- Create: `src/lib/famcal-cities.ts`
- Modify: `src/lib/i18n.ts` (every key this feature needs)
- Modify: `.env.example`
- Test: `$H/t1-famcal.test.ts`, `$H/t1-cities.test.ts`, `$H/t1-schema.test.ts`

**Interfaces:**
- Produces, in `src/lib/shabbat-view.ts` (client-safe, no imports):
  ```ts
  export type ShabbatGreeting = 'shabbat' | 'chag' | 'shabbat_chag' | 'yom_kippur';
  export interface ShabbatRow { key: string; name: string; at: string }            // at: UTC ISO
  export interface ShabbatDay { date: string; hebrewDate: string; occasion: string | null; sunset: string | null }
  export interface ShabbatBlock { eve: string; last: string; start: string; end: string; endName: string; greeting: ShabbatGreeting; days: ShabbatDay[]; rows: ShabbatRow[] }
  export interface ShabbatCredit { source: string; text: string; url?: string }
  export interface StoredShabbatTimes { city: string; community: string; through: string; fetchedAt: string; credits: ShabbatCredit[]; blocks: ShabbatBlock[] }
  export interface KitchenShabbat { blocks: ShabbatBlock[]; credits: ShabbatCredit[] }
  ```
- Produces, in `src/lib/famcal.ts` (server only):
  - `FAMCAL_API`, `COMMUNITIES`, `type Community`, `isCommunity()`, `class FamcalError { code: string; status: number | null }`;
  - `fetchShabbat(city, community, from, to): Promise<ShabbatAnswer>`, `fetchDay(city, community, date): Promise<DayAnswer>`;
  - the types `ShabbatAnswer`, `DayAnswer`, `FamcalHoliday`.
- Produces, in `src/lib/famcal-cities.ts` (client-safe): `interface FamcalCity { slug; name }`, `FAMCAL_CITIES`, `famcalCity(slug)`, `matchFamcalCity(text)`.
- Produces, in the schema: `groups.shabbatCity`, `groups.shabbatCommunity`, and the `shabbatTimes` table (`groupId`, `data`, `updatedAt`).

- [ ] **Step 1: Add the dependency.** Run `pnpm add p-retry@^9.0.0` in the repo. Expected: package.json lists `"p-retry": "^9.0.0"`.

- [ ] **Step 2: Schema.** In `src/db/schema.ts`, after `kitchenShowRecipe` in `groups`:
  ```ts
  // Kitchen screen Shabbat mode (src/lib/shabbat-times.ts): a famcal city slug,
  // null while the mode is off, and the community whose zmanim and end time it
  // shows. The times themselves live in shabbat_times.
  shabbatCity: varchar('shabbat_city', { length: 64 }),
  shabbatCommunity: varchar('shabbat_community', { length: 16 }).notNull().default('sephardi'),
  ```
  Add a table next to the other kitchen-related tables, with `import type { StoredShabbatTimes } from '@/lib/shabbat-view';` at the top of schema.ts. If the schema file avoids `@/` imports, use the relative path `'../lib/shabbat-view'`; check the file's existing imports first.
  ```ts
  // The Shabbat and Yom Tov times fetched from famcal for the kitchen screen, one
  // row per bakery (src/lib/shabbat-times.ts). Its own table because GET
  // /api/groups/:id sends the whole groups row to the mini app. The reader uses
  // a row only when its city and community still match the groups row.
  export const shabbatTimes = pgTable('shabbat_times', {
    groupId: integer('group_id').primaryKey().references(() => groups.id),
    data: jsonb('data').$type<StoredShabbatTimes>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  });
  ```

- [ ] **Step 3: Migration.** Create `drizzle/0033_shabbat_mode.sql`:
  ```sql
  -- Kitchen screen Shabbat mode: the bakery's famcal city (null = off) and community,
  -- and the times fetched from famcal, one row per bakery.
  ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "shabbat_city" varchar(64);--> statement-breakpoint
  ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "shabbat_community" varchar(16) DEFAULT 'sephardi' NOT NULL;--> statement-breakpoint
  CREATE TABLE IF NOT EXISTS "shabbat_times" (
    "group_id" integer PRIMARY KEY NOT NULL REFERENCES "groups"("id"),
    "data" jsonb NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  ```
  Append to `drizzle/meta/_journal.json` entries:
  ```json
  { "idx": 33, "version": "7", "when": 1793700000000, "tag": "0033_shabbat_mode", "breakpoints": true }
  ```

- [ ] **Step 4: Types.** Create `src/lib/shabbat-view.ts` with a header comment and the types listed under Interfaces:
  ```ts
  /**
   * The kitchen screen's Shabbat mode, as the screen sees it: the stored
   * stretches (built from famcal by src/lib/shabbat-build.ts) and, in Task 2,
   * what to show at a given instant. Client-safe: no imports, so the kitchen
   * screen's bundle never pulls in the database or famcal's client.
   */
  ```
  In each type, document what `start` (the eve's candle lighting), `end` (the stretch's end), `sunset` (that day's SHKIA) and `rows` (the prayer times after `start`, in time order) mean.

- [ ] **Step 5: City list.** Create `src/lib/famcal-cities.ts`. It holds famcal's 51 Israeli cities with famcal's Hebrew names, from famcal's `messages/he.json` `cities.*`, sorted with `localeCompare(b.name, 'he')` at module load. The data:
  ```
  jerusalem ירושלים · tel-aviv תל אביב · haifa חיפה · rishon-lezion ראשון לציון · petah-tikva פתח תקווה · ashdod אשדוד · netanya נתניה · beer-sheva באר שבע · bnei-brak בני ברק · holon חולון · ramat-gan רמת גן · ashkelon אשקלון · rehovot רחובות · bat-yam בת ים · beit-shemesh בית שמש · kfar-saba כפר סבא · herzliya הרצליה · hadera חדרה · modiin מודיעין · lod לוד · ramla רמלה · raanana רעננה · nof-hagalil נוף הגליל · rosh-haayin ראש העין · afula עפולה · kiryat-gat קריית גת · nahariya נהריה · eilat אילת · tiberias טבריה · tzfat צפת · karmiel כרמיאל · akko עכו · maale-adumim מעלה אדומים · modiin-illit מודיעין עילית · beitar-illit ביתר עילית · elad אלעד · dimona דימונה · hod-hasharon הוד השרון · nes-ziona נס ציונה · kiryat-shmona קריית שמונה · ariel אריאל · kiryat-ata קריית אתא · kiryat-motzkin קריית מוצקין · kiryat-bialik קריית ביאליק · kiryat-yam קריית ים · givatayim גבעתיים · yavne יבנה · netivot נתיבות · sderot שדרות · harish חריש · zichron-yaakov זכרון יעקב
  ```
  Code shape:
  ```ts
  export interface FamcalCity { slug: string; name: string }
  export const FAMCAL_CITIES: readonly FamcalCity[] = ([ /* the 51 above */ ] as FamcalCity[]).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  export function famcalCity(slug: string | null | undefined): FamcalCity | null {
    return FAMCAL_CITIES.find((c) => c.slug === slug) ?? null;
  }
  // Names the bakery may have typed for a city famcal lists under another name.
  const ALIASES: Record<string, string> = { 'תל אביב יפו': 'tel-aviv', 'מודיעין מכבים רעות': 'modiin', 'נצרת עילית': 'nof-hagalil' };
  /** Hyphens and maqaf as spaces, no niqqud or quote marks, doubled ו/י folded (קריית = קרית, תקווה = תקוה), lower case. */
  function normalize(text: string): string {
    return text
      .replace(/[-־–—_]/g, ' ')
      .replace(/[֑-ׇ]/g, '')
      .replace(/["'`׳״]/g, '')
      .replace(/וו/g, 'ו')
      .replace(/יי/g, 'י')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
  /** The famcal city the bakery's own city (free text from the delivery settings) names, or null. */
  export function matchFamcalCity(text: string | null | undefined): FamcalCity | null { /* compare normalize(text) with normalize(name), normalize(slug), then the aliases */ }
  ```
  Add a header comment: it is famcal's city list (`docs/api/jewish-times-v1.md`, "City slugs", IL only). A city famcal adds later shows up only after it's added here. The names are famcal's data, not app copy.

- [ ] **Step 6: famcal client.** Create `src/lib/famcal.ts`:
  ```ts
  import pRetry, { AbortError } from 'p-retry';
  import { z } from 'zod/v4';

  /**
   * The one client of famcal's Jewish times API v1 (https://famcal.bot, the
   * owner's own app; reference: famcal's docs/api/jewish-times-v1.md). The
   * kitchen screen's Shabbat mode takes its times here and nowhere else.
   * Server only: it reads FAMCAL_API_KEY.
   *
   * - The place is a famcal city slug, always with the community and lang=he;
   *   famcal answers 400 to any other parameter, so nothing else is sent.
   * - Network failures, 429 and 5xx are retried with backoff (p-retry); any
   *   other answer, a body that is not JSON, or one in a shape we don't know
   *   fails at once. famcal's v1 may add fields: unknown ones are dropped.
   * - Every failed attempt is logged with famcal's error code; the key never is.
   */

  export const FAMCAL_API = 'https://famcal.bot/api/v1';
  export const COMMUNITIES = ['sephardi', 'ashkenazi', 'chabad'] as const;
  export type Community = (typeof COMMUNITIES)[number];
  export function isCommunity(value: unknown): value is Community {
    return typeof value === 'string' && (COMMUNITIES as readonly string[]).includes(value);
  }

  /** `code` is famcal's error code (UNKNOWN_CITY, INVALID_KEY, RATE_LIMITED, …), or NO_KEY / BAD_ANSWER / HTTP_<status> of ours. */
  export class FamcalError extends Error {
    constructor(readonly code: string, readonly status: number | null, message: string) {
      super(message);
      this.name = 'FamcalError';
    }
  }

  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const time = z.object({ at: z.string().nullable(), local: z.string().nullable() });
  const holiday = z.object({ title: z.string(), brief: z.string(), kind: z.string(), chag: z.boolean() });
  const row = z.object({ key: z.string(), opinion: z.string().nullable(), name: z.string(), at: z.string().nullable(), local: z.string().nullable() });
  const credit = z.object({ source: z.string(), text: z.string(), url: z.string().optional() });

  const shabbatAnswer = z.object({
    blocks: z.array(
      z.object({
        eve: day,
        last: day,
        candleLighting: time,
        start: time,
        end: z.object({ key: z.string(), name: z.string(), at: z.string().nullable(), local: z.string().nullable() }).nullable(),
        parasha: z.object({ title: z.string(), brief: z.string() }).nullable(),
        holidays: z.array(holiday),
      })
    ),
    credits: z.array(credit),
  });
  const dayAnswer = z.object({
    date: day,
    hebrewDate: z.object({ gematriya: z.string(), day: z.number(), month: z.string() }),
    holidays: z.array(holiday),
    rows: z.array(row),
    credits: z.array(credit),
  });
  export type ShabbatAnswer = z.infer<typeof shabbatAnswer>;
  export type DayAnswer = z.infer<typeof dayAnswer>;
  export type FamcalHoliday = z.infer<typeof holiday>;

  /** famcal's error code from an error body ({ error: { code, message } }), or HTTP_<status>. */
  async function errorCode(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: { code?: unknown } };
      if (typeof body?.error?.code === 'string') return body.error.code;
    } catch (err) {
      console.warn(`[famcal] a ${res.status} answer had no JSON error body:`, err instanceof Error ? err.message : err);
    }
    return `HTTP_${res.status}`;
  }

  async function famcalGet<T>(path: 'shabbat' | 'day', params: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
    const key = process.env.FAMCAL_API_KEY;
    if (!key) {
      console.error('[famcal] FAMCAL_API_KEY is not set');
      throw new FamcalError('NO_KEY', null, 'FAMCAL_API_KEY is not set');
    }
    const url = `${FAMCAL_API}/${path}?${new URLSearchParams({ ...params, lang: 'he' })}`;
    return pRetry(
      async () => {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
        if (!res.ok) {
          const code = await errorCode(res);
          const err = new FamcalError(code, res.status, `famcal /${path} answered ${res.status} ${code}`);
          if (res.status === 429 || res.status >= 500) throw err; // retried; logged by onFailedAttempt
          console.error(`[famcal] /${path} refused: ${res.status} ${code}`);
          throw new AbortError(err);
        }
        let body: unknown;
        try {
          body = await res.json();
        } catch (cause) {
          console.error(`[famcal] /${path} answered with a body that is not JSON:`, cause);
          throw new AbortError(new FamcalError('BAD_ANSWER', res.status, `famcal /${path} answered with a body that is not JSON`));
        }
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          console.error(`[famcal] /${path} answered in a shape we don't know:`, parsed.error.message);
          throw new AbortError(new FamcalError('BAD_ANSWER', res.status, `famcal /${path} answered in an unknown shape`));
        }
        return parsed.data;
      },
      {
        retries: 3,
        factor: 2,
        minTimeout: 1000,
        randomize: true,
        onFailedAttempt: ({ error, attemptNumber, retriesLeft }) =>
          console.warn(`[famcal] /${path} attempt ${attemptNumber} failed (${retriesLeft} retries left): ${error.message}`),
      }
    );
  }

  /** Every Shabbat and Yom Tov stretch whose eve is from `from` to `to` (yyyy-MM-dd at the place), plus one under way on `from`. */
  export function fetchShabbat(city: string, community: Community, from: string, to: string): Promise<ShabbatAnswer> {
    return famcalGet('shabbat', { city, community, from, to }, shabbatAnswer);
  }

  /** One day's zmanim, holidays and Hebrew date at the place. */
  export function fetchDay(city: string, community: Community, date: string): Promise<DayAnswer> {
    return famcalGet('day', { city, community, date }, dayAnswer);
  }
  ```
  If `z.ZodType<T>` does not accept the schemas under zod/v4 typing, use the pattern `schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { message: string } } }`. Keep it typed with no `any`.

- [ ] **Step 7: Strings.** Add to `src/lib/i18n.ts`. Put the `kitchen.*` keys next to the existing kitchen keys and the `notify.*` keys next to `notify.reminders_stalled*`:
  ```ts
  'kitchen.shabbat_greeting_shabbat': 'שבת שלום',
  'kitchen.shabbat_greeting_chag': 'חג שמח',
  'kitchen.shabbat_greeting_shabbat_chag': 'שבת שלום וחג שמח',
  'kitchen.shabbat_greeting_yom_kippur': 'גמר חתימה טובה',
  'kitchen.shabbat_candles': 'הדלקת נרות',
  'kitchen.shabbat_next': 'הזמנים הבאים',
  'kitchen.shabbat_back': 'ההזמנות יחזרו למסך ב־{time}',
  'kitchen.shabbat_mode': 'מצב שבת',
  'kitchen.shabbat_mode_hint': 'מהדלקת הנרות ועד צאת השבת או החג, המסך מציג ברכה וזמני היום במקום ההזמנות. הזמנים מ־famcal.',
  'kitchen.shabbat_city': 'עיר',
  'kitchen.shabbat_city_pick': 'בחרו עיר',
  'kitchen.shabbat_city_not_found': 'העיר של המאפייה ({city}) לא ברשימה של famcal. בחרו את העיר הקרובה.',
  'kitchen.shabbat_community': 'מנהג',
  'kitchen.shabbat_community_sephardi': 'ספרדי',
  'kitchen.shabbat_community_ashkenazi': 'אשכנזי',
  'kitchen.shabbat_community_chabad': 'חב״ד',
  'kitchen.shabbat_saving': 'מעדכן זמנים מ־famcal…',
  'kitchen.shabbat_preview_time': '{label}: {day}, {time}',
  'kitchen.shabbat_famcal_failed': 'famcal לא ענה, ולכן שום דבר לא נשמר. נסו שוב בעוד דקה.',
  'kitchen.shabbat_no_key': 'חסר מפתח famcal בשרת (FAMCAL_API_KEY), ולכן שום דבר לא נשמר.',
  'notify.shabbat_stale': 'זמני השבת של מסך המטבח לא מתעדכנים',
  'notify.shabbat_stale_until': 'הזמנים השמורים מגיעים רק עד {date}. אחרי זה המסך לא ייכנס למצב שבת.',
  'notify.shabbat_stale_none': 'אין זמני שבת שמורים, ולכן המסך לא ייכנס למצב שבת.',
  'notify.shabbat_stale_hint': 'כדאי לבדוק ש־famcal עובד ושהמפתח FAMCAL_API_KEY בתוקף.',
  ```

- [ ] **Step 8: .env.example.** After the Gemini block:
  ```
  # famcal's Jewish times API (https://famcal.bot): the kitchen screen's Shabbat
  # mode. A server key made in famcal's admin panel (API keys, New key), no origins.
  FAMCAL_API_KEY=
  ```

- [ ] **Step 9: Tests.**
  - **`$H/t1-schema.test.ts`:** call `setup()` from `./pgdb`. Insert a user and a group, then assert:
    - `shabbat_city` is null and `shabbat_community` is `'sephardi'` by default;
    - a `shabbat_times` row can be inserted and read back, its jsonb round-trips;
    - a row for a missing group id fails (foreign key).
  - **`$H/t1-cities.test.ts`:**
    - 51 cities with unique slugs, sorted by Hebrew;
    - `famcalCity('beit-shemesh').name === 'בית שמש'`;
    - matches: `'קרית גת'` → kiryat-gat, `'פתח תקוה'` → petah-tikva, `'תל אביב-יפו'` → tel-aviv, `' בית־שמש '` → beit-shemesh, `'Beit Shemesh'` → beit-shemesh, `'מודיעין-מכבים-רעות'` → modiin;
    - no match: `'גבעת זאב'`, `''`, `null`.
  - **`$H/t1-famcal.test.ts`:** replace `globalThis.fetch` with a recorder that serves a queue of `Response`s or throws, and set `process.env.FAMCAL_API_KEY = 'fcj_test'`. Use real fixtures from the reference shape (the `/shabbat` example and a `/day` example; build them in a shared `$H/fixtures.ts`, which Tasks 2–7 reuse). Assert:
    1. **Success.** The URL is exactly `https://famcal.bot/api/v1/shabbat?city=jerusalem&community=sephardi&from=2026-11-13&to=2026-11-14&lang=he`, the header is `Authorization: Bearer fcj_test`, there's 1 call, and the answer is parsed. An extra unknown field in the answer is accepted.
    2. **500 then 200:** 2 calls, resolves.
    3. **429 then 200:** 2 calls.
    4. **A network failure** (`throw new TypeError('fetch failed')`) then 200: 2 calls.
    5. **400 `{error:{code:'UNKNOWN_CITY'}}`:** 1 call, rejects with `FamcalError` code `UNKNOWN_CITY`, status 400.
    6. **401 `INVALID_KEY`:** 1 call, no retry.
    7. **200 with an HTML body:** 1 call, `BAD_ANSWER`.
    8. **200 with `{blocks:"x"}`:** 1 call, `BAD_ANSWER`.
    9. **Four 503s:** 4 calls (1 + 3 retries), rejects with code `KEYS_UNAVAILABLE`. This case takes about 7 s with real backoff, which is fine.
    10. **`FAMCAL_API_KEY` unset:** `NO_KEY`, 0 calls.

  Run each with `$H/run.sh $H/<file>`. Expected: each prints its ok lines and exits 0.

- [ ] **Step 10: Gate.** Run `npx tsc --noEmit` and `pnpm exec eslint src/lib/famcal.ts src/lib/famcal-cities.ts src/lib/shabbat-view.ts src/db/schema.ts src/lib/i18n.ts`. Expected: clean.

- [ ] **Step 11: Commit** with the message `feat(shabbat): famcal client, city list, schema and strings for the kitchen Shabbat mode`.

---

### Task 2: Pure logic: build the stored timeline, pick what to show

**Files:**
- Create: `src/lib/shabbat-build.ts` (server and tests; pure, no I/O)
- Modify: `src/lib/shabbat-view.ts` (add the functions)
- Test: `$H/t2-build.test.ts`, `$H/t2-view.test.ts`

**Interfaces:**
- Consumes: the types from Task 1; `ShabbatAnswer`, `DayAnswer` and `FamcalHoliday` from `famcal.ts`; `addDaysStr` and `weekdayIndex` from `date-utils`.
- Produces, in `shabbat-build.ts`:
  ```ts
  export const HORIZON_DAYS = 35;          // how far ahead one fetch reaches
  export const SCREEN_DAYS = 8;            // how far ahead the kitchen copy carries stretches
  export const WARN_DAYS = 8;              // warn when the stored times reach less far than this
  export const SHOWN_ROW_KEYS: readonly string[];
  export function daysOfBlock(eve: string, last: string): string[];          // eve..last inclusive
  export function greetingFor(days: { date: string; hebrewDay: number; hebrewMonth: string }[], hasChag: boolean): ShabbatGreeting;
  export function occasionOf(holidays: FamcalHoliday[]): string | null;
  export function buildShabbatTimes(input: { city: string; community: string; through: string; fetchedAt: string; shabbat: ShabbatAnswer; days: Map<string, DayAnswer> }): StoredShabbatTimes;
  export function blocksAhead(blocks: ShabbatBlock[], today: string): ShabbatBlock[];   // last >= today && eve <= today + SCREEN_DAYS
  export function coverageGap(times: StoredShabbatTimes | null, today: string): { through: string | null } | null; // null = enough
  ```
- Produces, in `shabbat-view.ts`:
  ```ts
  export const NEXT_ROWS = 4;
  export interface ShabbatView { block: ShabbatBlock; day: ShabbatDay; upcoming: ShabbatRow[] }
  export function activeBlock(blocks: ShabbatBlock[], now: number): ShabbatBlock | null;   // start <= now < end
  export function shabbatViewAt(blocks: ShabbatBlock[], now: number): ShabbatView | null;
  export function nextChangeIn(blocks: ShabbatBlock[], now: number): number;              // ms, 1 000..60 000
  ```

- [ ] **Step 1: Builder.** `src/lib/shabbat-build.ts`:
  ```ts
  import { addDaysStr, weekdayIndex } from './date-utils';
  import type { DayAnswer, FamcalHoliday, ShabbatAnswer } from './famcal';
  import type { ShabbatBlock, ShabbatCredit, ShabbatGreeting, StoredShabbatTimes } from './shabbat-view';

  /**
   * famcal's answers made into what the kitchen screen keeps: one entry per
   * Shabbat or Yom Tov stretch with its candle lighting (the mode turns on),
   * its end (it turns off), the greeting, each rest day's Hebrew date and
   * occasion, and the prayer times shown on the screen. Pure: famcal is called
   * by src/lib/shabbat-times.ts, which hands the answers here.
   */

  export const HORIZON_DAYS = 35;
  export const SCREEN_DAYS = 8;
  export const WARN_DAYS = 8;

  /**
   * The famcal rows the screen lists, by key (famcal's names carry the opinion).
   * Left out on purpose: dawn, misheyakir, mincha ketana, the nightfalls,
   * midnight and the end rows; the end has its own place on the screen.
   */
  export const SHOWN_ROW_KEYS: readonly string[] = [
    'NETZ', 'SOF_SHMA_MGA', 'SOF_SHMA_GRA', 'SOF_TFILA', 'CHATZOT', 'MINCHA_GEDOLA',
    'PLAG_HALACHA_BERURA', 'PLAG_YALKUT_YOSEF', 'PLAG_GRA', 'SHKIA', 'CANDLE_LIGHTING', 'CANDLE_LIGHTING_NOT_BEFORE',
  ];

  export function daysOfBlock(eve: string, last: string): string[] {
    const out: string[] = [];
    for (let d = eve; d <= last; d = addDaysStr(d, 1)) out.push(d);
    return out;
  }

  /** Yom Kippur (10 Tishrei by famcal's Hebrew date) first, then Shabbat with or without a Yom Tov day, then Yom Tov alone. */
  export function greetingFor(days: { date: string; hebrewDay: number; hebrewMonth: string }[], hasChag: boolean): ShabbatGreeting {
    if (days.some((d) => d.hebrewMonth === 'Tishrei' && d.hebrewDay === 10)) return 'yom_kippur';
    const shabbat = days.some((d) => weekdayIndex(d.date) === 6);
    if (hasChag) return shabbat ? 'shabbat_chag' : 'chag';
    return 'shabbat';
  }

  /** The day's name on the screen: its Yom Tov, else chol hamoed, else a special Shabbat, else the parasha. */
  export function occasionOf(holidays: FamcalHoliday[]): string | null {
    return (
      holidays.find((h) => h.chag)?.title ??
      holidays.find((h) => h.kind === 'cholHamoed')?.title ??
      holidays.find((h) => h.kind === 'specialShabbat')?.title ??
      holidays.find((h) => h.kind === 'parasha')?.title ??
      null
    );
  }

  const iso = (at: string): string => new Date(at).toISOString();
  ```
  Write `buildShabbatTimes`:
  - **Credits:** the union of `shabbat.credits` and every day answer's `credits`, first one per `source`, in the order first seen.
  - **Each block of `shabbat.blocks`:**
    - If `candleLighting.at` or `end?.at` is null, `console.warn('[shabbat] famcal gave the stretch from <eve> no candle lighting or end; it is left out')` and skip it.
    - `all = daysOfBlock(eve, last)` and `rest = all.slice(1)`. Each day's answer is `days.get(d)`. If one is missing, throw `new Error('[shabbat] no famcal day answer for <d>')`: the caller always fetches every day, so a missing one is a bug, never silently skipped.
    - `greeting = greetingFor(rest.map(...hebrewDate.day/month...), block.holidays.some((h) => h.chag))`.
    - `days = rest.map(d => ({ date: d, hebrewDate: ans.hebrewDate.gematriya, occasion: occasionOf(ans.holidays), sunset: SHKIA row's at → iso, or null }))`.
    - `rows`: every row of every day in `all` whose key is in `SHOWN_ROW_KEYS`, whose `at` isn't null, and whose instant is strictly after `start`. Map each to `{ key, name, at: iso(at) }` and sort by instant.
    - Push `{ eve, last, start: iso(candleLighting.at), end: iso(end.at), endName: end.name, greeting, days, rows }`.
  - **Return** `{ city, community, through, fetchedAt, credits, blocks }`.

  Write `blocksAhead` and `coverageGap`:
  ```ts
  export function blocksAhead(blocks: ShabbatBlock[], today: string): ShabbatBlock[] {
    const until = addDaysStr(today, SCREEN_DAYS);
    return blocks.filter((b) => b.last >= today && b.eve <= until);
  }
  /** Null when the stored times reach at least WARN_DAYS ahead; else how far they do reach (null: there are none). */
  export function coverageGap(times: StoredShabbatTimes | null, today: string): { through: string | null } | null {
    if (!times) return { through: null };
    return times.through < addDaysStr(today, WARN_DAYS) ? { through: times.through } : null;
  }
  ```

- [ ] **Step 2: View functions.** Append to `src/lib/shabbat-view.ts`, which still has no imports:
  ```ts
  export const NEXT_ROWS = 4;
  const MIN_WAIT_MS = 1_000;
  const MAX_WAIT_MS = 60_000;
  const at = (iso: string): number => Date.parse(iso);

  export interface ShabbatView { block: ShabbatBlock; day: ShabbatDay; upcoming: ShabbatRow[] }

  /** The stretch under way at `now`: from candle lighting (included) to the end (not included). */
  export function activeBlock(blocks: ShabbatBlock[], now: number): ShabbatBlock | null {
    return blocks.find((b) => at(b.start) <= now && now < at(b.end)) ?? null;
  }

  /**
   * What the screen shows at `now`, or null when no stretch is under way. The day
   * (Hebrew date, occasion) is the first rest day whose sunset is still ahead,
   * else the last one; the list is the next NEXT_ROWS times of the whole stretch,
   * so the second night's candle lighting stays listed after the first day's sunset.
   */
  export function shabbatViewAt(blocks: ShabbatBlock[], now: number): ShabbatView | null {
    const block = activeBlock(blocks, now);
    if (!block || block.days.length === 0) return null;
    const day = block.days.find((d) => d.sunset !== null && at(d.sunset) > now) ?? block.days[block.days.length - 1];
    const upcoming = block.rows.filter((r) => at(r.at) > now).slice(0, NEXT_ROWS);
    return { block, day, upcoming };
  }

  /** How long until the screen should look again: the next start, end, sunset or listed time, and at least once a minute. */
  export function nextChangeIn(blocks: ShabbatBlock[], now: number): number {
    let next = now + MAX_WAIT_MS;
    for (const b of blocks) {
      for (const iso of [b.start, b.end, ...b.days.map((d) => d.sunset), ...b.rows.map((r) => r.at)]) {
        if (iso === null) continue;
        const t = at(iso);
        if (t > now && t < next) next = t;
      }
    }
    return Math.max(MIN_WAIT_MS, next - now);
  }
  ```
  `rows` are stored sorted, so `upcoming` keeps that order.

- [ ] **Step 3: Builder tests,** `$H/t2-build.test.ts`, using `$H/fixtures.ts`. Add helpers there that make a `/shabbat` block and a `/day` answer from a few fields: date, Hebrew day and month, holidays, and rows with `at` values in `+02:00`. Cases:
  1. **Plain Shabbat**, eve Fri 2026-11-13, last 2026-11-14: greeting `shabbat`; `start` is the candle-lighting instant in UTC (`2026-11-13T14:25:00.000Z` for `16:25+02:00`); `endName` 'צאת השבת'; `days` has one day with `occasion: 'פרשת תולדות'` and the gematriya; the sunset is Saturday's SHKIA.
  2. **Rows:**
     - the eve's `CANDLE_LIGHTING` (equal to `start`) is not listed;
     - the eve's `SHKIA` (after `start`) is listed;
     - Saturday's NETZ…SHKIA are listed;
     - ALOT, MISHEYAKIR, MINCHA_KETANA, TZEIT, SHABBAT_ENDS and CHATZOT_HALAYLA are not;
     - a null `at` is dropped;
     - the order is by time.
  3. **A Yom Tov Friday into Shabbat** (eve Thursday, a `chag` holiday on Friday, last Saturday): `shabbat_chag`. The Friday day's occasion is the chag title. The Friday `CANDLE_LIGHTING` row (before Friday's sunset) is listed.
  4. **Shabbat into a Yom Tov Sunday** (last day Sunday, end key `YOM_TOV_ENDS`): `shabbat_chag`.
  5. **A midweek Yom Tov** (eve Tuesday, last Wednesday, chag): `chag`.
  6. **ראש השנה Thursday–Friday into Shabbat** (a 3-day block): `shabbat_chag`, 3 days.
  7. **Yom Kippur on a Monday** (Hebrew day 10, `Tishrei`): `yom_kippur`.
  8. **Yom Kippur on Shabbat:** `yom_kippur`.
  9. **Occasion priority:** chag over cholHamoed over specialShabbat over parasha; roshChodesh and minor alone give `null`.
  10. **A block with `candleLighting.at: null`** is skipped, with a warning logged (capture `console.warn`).
  11. **A missing day answer** throws.
  12. **Credits:** the union by source, keeping order: the `/shabbat` copernicus and geonames, then a `/day` openstreetmap, gives 3, no duplicates.
  13. **`blocksAhead`:** keeps a block whose last day is today (Saturday) and one whose eve is today+8; drops yesterday's and today+9's.
  14. **`coverageGap`:** null data → `{ through: null }`; `through` of today+7 → gap; today+8 → null.

- [ ] **Step 4: View tests,** `$H/t2-view.test.ts`. Build blocks by hand (UTC ISO) or with `buildShabbatTimes` on the fixtures.
  1. **`activeBlock`:** null 1 ms before `start`; the block at exactly `start`; the block 1 ms before `end`; null at exactly `end`.
  2. **`shabbatViewAt` on Friday night** for a 1-day Shabbat: day = Saturday; `upcoming` is the first 4 Saturday rows plus the eve's SHKIA if it's still ahead, in time order.
  3. **At Saturday 12:00:** `upcoming` holds only rows after 12:00, at most 4.
  4. **After Saturday's sunset but before the end:** day = the last day; `upcoming` is empty.
  5. **Two-day ראש השנה:**
     - before day 1's sunset, day = day 1;
     - 1 ms after day 1's sunset, day = day 2;
     - the `CANDLE_LIGHTING_NOT_BEFORE` row of day 1 (after its sunset) is still in `upcoming` until its time.
  6. **`nextChangeIn`:**
     - outside any stretch with `start` 10 s away → 10 000;
     - with nothing within a minute → 60 000;
     - with a row 200 ms away → 1 000.

  Run: `$H/run.sh $H/t2-build.test.ts` and `$H/run.sh $H/t2-view.test.ts`. Expected: both print ok lines and exit 0.

- [ ] **Step 5: Gate.** Run `npx tsc --noEmit` and eslint on the two files. Expected: clean.
- [ ] **Step 6: Commit** with `feat(shabbat): build the stored timeline from famcal's answers and pick the screen's view`.

---

### Task 3: Storage and orchestration; kitchen data carries the stretches

**Files:**
- Create: `src/lib/shabbat-times.ts`
- Modify: `src/lib/kitchen-sheet.ts` (`KitchenData.shabbat`)
- Test: `$H/t3-store.test.ts`

**Interfaces:**
- Consumes: `fetchShabbat`, `fetchDay`, `FamcalError`, `Community` and `isCommunity` (Task 1); `buildShabbatTimes`, `daysOfBlock`, `blocksAhead`, `coverageGap` and `HORIZON_DAYS` (Task 2); `matchFamcalCity` (Task 1).
- Produces:
  ```ts
  export async function fetchShabbatTimes(city: string, community: Community, today: string, now?: Date): Promise<StoredShabbatTimes>;
  export async function readShabbatTimes(groupId: number): Promise<StoredShabbatTimes | null>;   // only when it matches the groups row
  export async function saveShabbatSetting(groupId: number, city: string | null, community: Community, today?: string): Promise<void>; // throws FamcalError
  export type RefreshResult = 'off' | 'refreshed' | 'changed' | 'failed';
  export async function refreshShabbatTimes(groupId: number, today?: string): Promise<RefreshResult>;
  export async function shabbatCoverageGap(groupId: number, today: string): Promise<{ through: string | null } | null>; // null also when the mode is off
  export interface ShabbatPreview { start: string; end: string; endName: string; occasion: string | null }
  export interface ShabbatSettings { city: string | null; community: Community; homeCity: string | null; suggestedCity: string | null; next: ShabbatPreview | null; credits: ShabbatCredit[] }
  export async function shabbatSettings(groupId: number, now?: Date): Promise<ShabbatSettings>;
  export function kitchenShabbat(times: StoredShabbatTimes | null, today: string): KitchenShabbat | null;
  ```
- `KitchenData` gains `shabbat: KitchenShabbat | null`.

- [ ] **Step 1: `src/lib/shabbat-times.ts`.** Header comment (the flow in 5 lines). Then:
  - **`fetchShabbatTimes`:**
    - `to = addDaysStr(today, HORIZON_DAYS)`;
    - `shabbat = await fetchShabbat(city, community, today, to)`;
    - `dates` = the unique values of `shabbat.blocks.flatMap(b => daysOfBlock(b.eve, b.last))`;
    - `answers = await Promise.all(dates.map((d) => fetchDay(city, community, d)))`. Any failure rejects the whole fetch;
    - return `buildShabbatTimes({ city, community, through: to, fetchedAt: now.toISOString(), shabbat, days: new Map(dates.map((d, i) => [d, answers[i]])) })`.
  - **`readShabbatTimes`:**
    - one query: `groups` left join `shabbatTimes` on the group id, selecting city, community and data;
    - return null if the city is null or there is no data;
    - if `data.city !== city || data.community !== community`, log `console.warn('[shabbat] group <id>: the stored times are for another city or community; not shown')` and return null;
    - else return `data`.
  - **`saveShabbatSetting`:**
    - **city null:** delete the `shabbatTimes` row, update groups `{ shabbatCity: null, shabbatCommunity: community }`, log `[shabbat] mode turned off for group <id>`.
    - **otherwise:** `data = await fetchShabbatTimes(city, community, today)` (it throws on failure, so nothing is written); insert into `shabbatTimes` with `onConflictDoUpdate` on `groupId` (data, `updatedAt: new Date()`); then update groups `{ shabbatCity: city, shabbatCommunity: community }`; log `[shabbat] group <id> set to <city>/<community>: <n> stretches through <through>`.
    - The route validates the city and community. This function trusts its caller, but it's typed.
  - **`refreshShabbatTimes`:**
    - read the groups city and community; null city → `'off'`;
    - `try { data = await fetchShabbatTimes(...) } catch (err) { console.error('[shabbat] refreshing the times failed for group <id>; the stored ones stay:', err); return 'failed'; }`;
    - then **one conditional statement**:
      ```ts
      const res = await db.execute(sql`
        insert into shabbat_times (group_id, data, updated_at)
        select ${groupId}, ${JSON.stringify(data)}::jsonb, now()
        from groups where id = ${groupId} and shabbat_city = ${city} and shabbat_community = ${community}
        on conflict (group_id) do update set data = excluded.data, updated_at = excluded.updated_at
        returning group_id`);
      ```
    - no row returned → `console.warn('[shabbat] group <id> changed its Shabbat setting during the refresh; the new setting's times stay')` and return `'changed'`; else `'refreshed'`.
  - **`shabbatCoverageGap`:** read the city; null → null. Otherwise `coverageGap(await readShabbatTimes(groupId), today)`.
  - **`shabbatSettings`:**
    - read `shabbatCity`, `shabbatCommunity` and `deliveryHomeCity` from groups, plus `readShabbatTimes`;
    - `suggestedCity = matchFamcalCity(homeCity)?.slug ?? null`;
    - `next` = the first block with `Date.parse(end) > now`, as `{ start, end, endName, occasion: days[0]?.occasion ?? null }`, or null;
    - `credits` = `times?.credits ?? []`;
    - `community` = the groups value if `isCommunity(...)`, else `'sephardi'` with a warning logged.
  - **`kitchenShabbat`:** null if `times` is null; `blocks = blocksAhead(times.blocks, today)`; null if empty; else `{ blocks, credits: times.credits }`.

- [ ] **Step 2: Kitchen data.**
  - In `src/lib/kitchen-sheet.ts`, add to `KitchenData`:
    ```ts
    /** Shabbat mode's coming stretches (src/lib/shabbat-times.ts); null while the mode is off. The screen picks the active one by its own clock. */
    shabbat: KitchenShabbat | null;
    ```
  - In `loadKitchenData`, read `readShabbatTimes(groupId)` alongside the existing `Promise.all`. Restructure only as much as needed to keep the types clean: a separate `await` before the `Promise.all` is fine, since it's one small query. Return `shabbat: kitchenShabbat(times, today)`.
  - Import the type `KitchenShabbat` from `./shabbat-view`.
  - Update the module header comment: one sentence on the Shabbat stretches riding along.

- [ ] **Step 3: Tests,** `$H/t3-store.test.ts`. PGlite `setup()`; insert a user, a group (`delivery_home_city = 'בית שמש'`) and a second group. Set `process.env.FAMCAL_API_KEY = 'fcj_test'` and serve `fetch` from the fixtures by URL: `/shabbat` returns the blocks, `/day?…date=X` returns X's answer. Count requests.
  1. **`saveShabbatSetting(1, 'jerusalem', 'sephardi', '2026-11-12')`:**
     - groups row city `jerusalem`;
     - the `shabbat_times` row has `through = 2026-11-12 + 35`;
     - the blocks are built;
     - the requests are exactly 1 `/shabbat` (`from=2026-11-12&to=2026-12-17`) plus one `/day` per day of each block.
  2. **`readShabbatTimes(1)`** returns the data. After `update groups set shabbat_city = 'haifa'`, it returns null (mismatch) and logs a warning. Restore it.
  3. **Save with famcal failing** (every `/day` answers 400 `UNKNOWN_CITY`): rejects with `FamcalError`; the groups row and the `shabbat_times` row are exactly as before (compare a full snapshot).
  4. **Save with no key** (`delete process.env.FAMCAL_API_KEY`): rejects with `NO_KEY`; nothing is written; 0 requests.
  5. **Off:** `saveShabbatSetting(1, null, 'ashkenazi')` → the city is null, the community `ashkenazi`, no times row; `readShabbatTimes` is null.
  6. **`refreshShabbatTimes`:**
     - off → `'off'`;
     - with the city set → `'refreshed'` and `updated_at` moves;
     - famcal failing → `'failed'` and the data unchanged;
     - **the race:** stub `fetch` so that while `/shabbat` is in flight, the test runs `update groups set shabbat_city = 'haifa'`. The refresh returns `'changed'`, and the stored row is still the earlier jerusalem one.
  7. **`shabbatCoverageGap`:**
     - off → null;
     - fresh data → null;
     - after `update shabbat_times set data = jsonb_set(data, '{through}', '"2026-11-15"')` with today 2026-11-12 → `{ through: '2026-11-15' }`;
     - no row with the city set → `{ through: null }`.
  8. **`shabbatSettings(1, now)`:**
     - `suggestedCity: 'beit-shemesh'`;
     - `next` is the first stretch not yet ended;
     - credits present;
     - with `delivery_home_city = 'גבעת זאב'` → `suggestedCity: null`, `homeCity: 'גבעת זאב'`.
  9. **`loadKitchenData(1, today)`:**
     - mode on → `shabbat.blocks` has only the stretches in `blocksAhead`, plus the credits;
     - mode off → `shabbat: null`;
     - group 2 → null.

  Run: `$H/run.sh $H/t3-store.test.ts`. Expected: ok lines, exit 0.
- [ ] **Step 4: Gate.** tsc and eslint on the changed files.
- [ ] **Step 5: Commit** with `feat(shabbat): save, refresh and read the famcal times; the kitchen copy carries the coming stretches`.

---

### Task 4: Settings route `GET`/`PUT /api/groups/[id]/shabbat`

**Files:**
- Create: `src/app/api/groups/[id]/shabbat/route.ts`
- Test: `$H/t4-route.test.ts`

**Interfaces:**
- Consumes: `shabbatSettings`, `saveShabbatSetting` (Task 3); `famcalCity` (Task 1); `FamcalError`, `COMMUNITIES` (Task 1).
- Produces:
  - `GET` → `200 ShabbatSettings`.
  - `PUT { city: string | null, community }` → `200 ShabbatSettings`.
  - Errors:
    - 400 `{error}` on a bad body or unknown city;
    - 403 for a role other than owner or manager;
    - 400 `Group mismatch` when the path id ≠ the `X-Group-Id` group;
    - 502 `{error:'famcal_failed'}`, 503 `{error:'famcal_no_key'}`, 500 `{error:'Could not save'}`.

- [ ] **Step 1: The route.** Mirror `src/app/api/groups/[id]/kitchen/route.ts`: `withGroup`, the same `refuse()` with `pathname.split('/').at(-2)`, owners and managers only. Comment: who may change it, and that PUT fetches famcal first and writes nothing when it fails.
  ```ts
  const bodySchema = z.object({ city: z.string().max(64).nullable(), community: z.enum(COMMUNITIES) });
  // PUT:
  // parse → 400 on failure; city !== null && !famcalCity(city) → errorResponse('Unknown city', 400)
  // try { await saveShabbatSetting(groupId, city, community) }
  // catch (err) {
  //   if (err instanceof FamcalError && err.code === 'NO_KEY') { console.error('[shabbat] save refused for group <id>: FAMCAL_API_KEY is not set'); return errorResponse('famcal_no_key', 503); }
  //   if (err instanceof FamcalError) { console.error(`[shabbat] save for group <id> failed: famcal ${err.status ?? '-'} ${err.code}`); return errorResponse('famcal_failed', 502); }
  //   console.error('[shabbat] save failed for group <id>:', err); return errorResponse('Could not save', 500);
  // }
  // return jsonResponse(await shabbatSettings(groupId));
  // GET: try { return jsonResponse(await shabbatSettings(groupId)) } catch (err) { console.error(...); return errorResponse('Could not load', 500) }
  ```
  Use `import { z } from 'zod/v4'`, as `groups/[id]/route.ts` does.

- [ ] **Step 2: Tests,** `$H/t4-route.test.ts`. Import `GET` and `PUT` from the route and `setAuth` from `./api-utils-stub`. Requests go to `http://x/api/groups/1/shabbat` with `x-group-id: 1`. Fixture `fetch` as in Task 3.
  1. **A baker** (`setAuth({ memberships: [{ groupId: 1, role: 'baker' }] })`): GET and PUT → 403, and 0 famcal requests.
  2. **Path id 2 with header 1:** 400.
  3. **As owner:**
     - PUT `{city:'jerusalem', community:'sephardi'}` → 200 with `city:'jerusalem'`, a `next`, and credits;
     - GET returns the same;
     - PUT `{city:'nowhere', …}` → 400, no requests;
     - PUT `{city:'jerusalem', community:'x'}` → 400.
  4. **famcal failing:** 502 `famcal_failed`, and the DB is unchanged.
  5. **No key:** 503 `famcal_no_key`.
  6. **PUT `{city:null, community:'sephardi'}`** → 200 `city:null`, `next:null`.

  Run with `$H/run.sh`. Expected: exit 0.
- [ ] **Step 3: Gate.** tsc and eslint.
- [ ] **Step 4: Commit** with `feat(shabbat): settings route; a save fetches famcal first and writes nothing when it fails`.

---

### Task 5: Morning cron refresh and the Telegram warning

**Files:**
- Modify: `src/app/api/cron/morning-reminder/route.ts`
- Modify: `src/lib/notifications.ts` (`shabbatStaleText`, `notifyShabbatTimesStale`)
- Test: `$H/t5-cron.test.ts`

**Interfaces:**
- Consumes: `refreshShabbatTimes`, `shabbatCoverageGap` (Task 3).
- Produces: `export function shabbatStaleText(lang: 'en' | 'he', through: string | null): string` and `export async function notifyShabbatTimesStale(groupId: number, through: string | null): Promise<{ sent: number; failed: number }>`.

- [ ] **Step 1: The notification.** In `src/lib/notifications.ts`, next to `notifyRemindersStalled`:
  ```ts
  /** The warning the morning cron sends once the stored Shabbat times run short (src/lib/shabbat-times.ts). */
  export function shabbatStaleText(lang: 'en' | 'he', through: string | null): string {
    const reach = through
      ? t('notify.shabbat_stale_until', lang).replace('{date}', formatWeekdayShort(through))
      : t('notify.shabbat_stale_none', lang);
    return [`<b>⚠️ ${t('notify.shabbat_stale', lang)}</b>`, RULE, reach, ``, `<i>${t('notify.shabbat_stale_hint', lang)}</i>`].join('\n');
  }

  export async function notifyShabbatTimesStale(groupId: number, through: string | null): Promise<{ sent: number; failed: number }> {
    const recipients = await getRecipientsByRole(groupId, ['manager']);
    return sendToRecipients(recipients, (lang) => shabbatStaleText(lang, through));
  }
  ```

- [ ] **Step 2: The cron.**
  - Add `shabbatRefreshed`, `shabbatFailed` and `shabbatWarnings` to `Stats` (documented like the others) and initialize them to 0.
  - In the per-group loop, after the reminder health check:
    ```ts
    // Shabbat mode's times (src/lib/shabbat-times.ts): refreshed from famcal every
    // morning; a failure keeps the stored ones, and the owner hears only once
    // what is stored reaches less than a week and a day ahead.
    try {
      const result = await refreshShabbatTimes(group.id, today);
      if (result === 'refreshed') stats.shabbatRefreshed++;
      if (result === 'failed') stats.shabbatFailed++;
      if (result !== 'off') {
        const gap = await shabbatCoverageGap(group.id, today);
        if (gap) {
          const sent = await notifyShabbatTimesStale(group.id, gap.through);
          stats.shabbatWarnings++;
          stats.notified += sent.sent;
          stats.notifyFailed += sent.failed;
        }
      }
    } catch (err) {
      stats.nudgeFailed++;
      console.error(`[cron/morning-reminder] Shabbat times check failed for group ${group.id}:`, err);
    }
    ```

- [ ] **Step 3: Tests,** `$H/t5-cron.test.ts`.
  1. **`shabbatStaleText('he', '2026-11-20')`** contains 'זמני השבת של מסך המטבח לא מתעדכנים', the formatted day ('ו׳ 20/11' or whatever `formatWeekdayShort` gives; compute the expectation with the same function), and the hint. With `null` it has the "אין זמני שבת שמורים" line. No `{date}` is left over.
  2. **The cron handler** (`POST` from the route, with `process.env.CRON_SECRET = 'test'`, a `Bearer test` header and `DISABLE_OUTBOUND=1`, so Telegram sends are suppressed and logged):
     - **Fresh setup:** group 1 with the mode on and fresh data, famcal working → `shabbatRefreshed: 1`, `shabbatWarnings: 0`.
     - **famcal failing, `through` near:** set `through` to today+3 → `shabbatFailed: 1`, `shabbatWarnings: 1`, and the stored blocks unchanged.
     - **Mode off:** neither counter moves.

     The cron also runs the other nudges; they work on the empty orders. If importing the route pulls in modules the harness can't load, stub them the way the earlier harness did (`$A/tsconfig-*.json` paths). Report what was stubbed.
  Run: exit 0.
- [ ] **Step 4: Gate.** tsc and eslint.
- [ ] **Step 5: Commit** with `feat(shabbat): the morning cron refreshes famcal's times and warns when they run short`.

---

### Task 6: The kitchen screen's Shabbat view

**Files:**
- Create: `src/components/kitchen/ShabbatScreen.tsx`
- Modify: `src/components/kitchen/KitchenScreen.tsx`
- Modify: `src/app/kitchen/kitchen-css.ts`
- Test: `$H/t6-screen.test.tsx` (server render), `$H/t6-clock.test.tsx` (jsdom), `$H/t6-shots.cjs` (puppeteer screenshots)

**Interfaces:**
- Consumes: `shabbatViewAt`, `nextChangeIn`, `ShabbatView`, `ShabbatCredit` (Tasks 1–2); `KitchenData.shabbat` (Task 3).
- Produces: `export function ShabbatScreen({ view, credits }: { view: ShabbatView; credits: ShabbatCredit[] })`.

- [ ] **Step 1: ShabbatScreen.** It renders exactly the approved mockup's structure: `$S/shabbat-mock/screen.html` (S = the scratchpad). Read it first.
  - **No hooks;** imports `t` from `@/lib/i18n`. A file comment says what it shows and when.
  - **Markup** (`<main className="shabbat" role="status">`):
    - **The hero:** `<section className="hero">` with the inline candles `<svg className="candles" aria-hidden="true">` from the mockup (radial glow, wax, wick, two `<g className="flame">` with the second `flame b`, and the candlesticks). Every fill and stroke uses CSS variables, never literals.
    - **The greeting:** `<h1 className={'greeting' + (long ? ' long' : '')}>` with `t('kitchen.shabbat_greeting_' + greeting)`. `long` is true for `shabbat_chag` and `yom_kippur`.
    - **The occasion and date:** `<p className="occasion">` with `view.day.occasion`, left out when null, then `<p className="hdate">` with `view.day.hebrewDate`.
    - **The panel:** `<div className="window">` holding two cells: `<span className="t" dir="ltr">` with the clock of `block.start`, plus `<span className="l">` with `t('kitchen.shabbat_candles')`; and the clock of `block.end`, plus `block.endName`.
    - **The list,** only when `view.upcoming.length > 0`: `<section className="next"><h2>{t('kitchen.shabbat_next')}</h2><ul>` with one `<li>` per row (the first gets `className="soon"`), each holding `<span>{row.name}</span><span className="t" dir="ltr">{clock(row.at)}</span>`. Fix the mockup's `h2` inside a `ul`: the `h2` sits in the section, not the list.
    - **The footer:** `<footer className="foot"><p className="back">` with `t('kitchen.shabbat_back')` split around `{time}`, so the time sits in `<span dir="ltr">`, then `<div className="credits" dir="ltr">` with one `<p>` per credit.
  - **The clock:** `new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' })`.

- [ ] **Step 2: CSS.** Append to `KITCHEN_CSS`, in the same style as the rest of the file:
  - **Tokens:** add `--wax`, `--wax-edge`, `--metal`, `--flame`, `--flame-core` and `--glow` to the `:root` block and again to the dark `@media` block.
    - light: `#FBF7EE`, `#D9CFBD`, `#8C8374`, `#F2A43A`, `#FFF3C9`, `rgba(242,164,58,.22)`;
    - dark: `#EDE4D3`, `#9A8F7C`, `#7A7163`, `#F5AE45`, `#FFF6D6`, `rgba(245,174,69,.30)`.
  - **The `.shabbat` rules** from the mockup (`.shabbat`, `.hero`, `.candles`, `.flame`, `@keyframes flicker`, `.greeting` + `.greeting.long` at 40px, `.occasion`, `.hdate`, `.window`, `.next`, `.foot`, `.back`, `.credits`):
    - map the mockup's `--paper`/`--ink`/`--ink-soft`/`--rule` to the existing tokens of the same names;
    - the mono font is `var(--font-jetbrains), ui-monospace, monospace`, the text font `var(--font-assistant), system-ui, sans-serif`;
    - `.shabbat` has `min-height: 100dvh`, and the `.foot` sits at the bottom with `margin-top: auto`;
    - add a comment line for the section.
  - **Reduced motion:** `@media (prefers-reduced-motion: reduce) { .shabbat .flame { animation: none } }`.
  - **Short screens:** `@media (max-height: 700px)` shrinks the candles to 110px, the greeting to 42px (`.long` 34px), the panel numbers to 32px, the rows' padding to 6px, and hides the 4th row (`.next li:nth-child(4) { display: none }`).

- [ ] **Step 3: KitchenScreen.**
  - Add `const [now, setNow] = useState(() => Date.parse(renderedAt));`.
  - Add a timer effect:
    ```ts
    // The Shabbat view follows the phone's clock: look again at the next start,
    // end, sunset or listed time (src/lib/shabbat-view.ts), at least once a minute.
    // Polling (below) is unchanged on Shabbat.
    const blocks = data.shabbat?.blocks;
    useEffect(() => {
      if (!blocks) return;
      let timer = 0;
      const tick = () => {
        const current = Date.now();
        setNow(current);
        timer = window.setTimeout(tick, nextChangeIn(blocks, current));
      };
      tick();
      return () => window.clearTimeout(timer);
    }, [blocks]);
    ```
  - Compute `const shabbat = data.shabbat ? shabbatViewAt(data.shabbat.blocks, now) : null;`.
  - After the `disconnected` return: `if (shabbat) return <ShabbatScreen view={shabbat} credits={data.shabbat!.credits} />;`. Avoid the `!` if a narrowed local reads cleaner.
  - The poll effect, `useKeepAwake`, the dock and the sheets are unchanged.

- [ ] **Step 4: Server-render tests,** `$H/t6-screen.test.tsx` (`import './react-shim'`), using `renderToStaticMarkup(<KitchenScreen data=... stamp="s" epoch="e" renderedAt=... />)`. Build `KitchenData` from a minimal valid sample (copy the shape `t11-overdue.test.tsx` uses, with empty days allowed) plus `shabbat` built with the fixtures.
  1. **`renderedAt` 1 ms before `start`:** no `class="shabbat"`; `class="dock"` present.
  2. **`renderedAt` at `start`:**
     - `class="shabbat"`, 'שבת שלום', 'פרשת תולדות', the gematriya, '16:25' and '17:16' inside `dir="ltr"` spans;
     - 'הזמנים הבאים' and 4 `<li`, the first `class="soon"`;
     - 'ההזמנות יחזרו למסך ב־' followed by `<span dir="ltr">17:16</span>`;
     - the GeoNames credit text;
     - no `class="dock"`, no `class="sheet"`;
     - no raw `kitchen.` keys.
  3. **Each greeting** (`chag`, `shabbat_chag`, `yom_kippur`) renders its Hebrew text, and the long ones carry `greeting long`.
  4. **Occasion null:** no `class="occasion"`.
  5. **No upcoming rows:** no `class="next"`.

- [ ] **Step 5: The clock test,** `$H/t6-clock.test.tsx`, in jsdom.
  - **Setup:** create a JSDOM (`new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/kitchen', pretendToBeVisual: true })`) and assign `window`, `document`, `navigator` (no `wakeLock`, which is fine: the hook logs and continues), `HTMLElement` and `requestAnimationFrame` to `globalThis`.
  - **Fake time:** use `import { mock } from 'node:test'` with `mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: <1 min before start> })`.
  - **Fake fetch** for `/api/kitchen/state`: count the calls and answer `{ stamp: 's', epoch: 'e' }`.
  - **Render** with `createRoot` inside `act` (`import { act } from 'react'`; set `globalThis.IS_REACT_ACT_ENVIRONMENT = true`), with `renderedAt` = now.
  - **Assertions:**
    - at first, no `.shabbat` and the sheets are shown;
    - advance past `start` (`mock.timers.tick` inside `act`): `.shabbat` is shown;
    - advance 5 minutes: `/api/kitchen/state` was called about 10 more times (≥ 9), so **polling continues during Shabbat**;
    - advance past `end`: `.shabbat` is gone and the sheets are back;
    - the poll count kept growing.
  - **Cleanup:** unmount, then `mock.timers.reset()`.

  If the poll's `setInterval` and the effect's `setTimeout` interact badly with the mocked timers, report it rather than weakening the assertions.

- [ ] **Step 6: Screenshots,** `$H/t6-shots.cjs`.
  - **Pages:** write static pages with the real `SHEET_CSS + KITCHEN_CSS` and the Shabbat markup from the server render. Do it the way `$A/t11-overdue.test.tsx` does: the test writes the HTML to `$H/shots/` when given a directory argument, with the root layout's body classes spelled out and Google Fonts links for Assistant and JetBrains Mono, mapping `--font-assistant: Assistant` and `--font-jetbrains: 'JetBrains Mono'`.
  - **Shots:** take them with puppeteer-core from `$S/uicheck/node_modules`, using Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Cover light and dark (`emulateMediaFeatures prefers-color-scheme`), at 390×780 and 360×640, with `prefers-reduced-motion: reduce`.
  - **Checks, measured and reported:**
    - no horizontal overflow at either size;
    - at 390×780, Friday night shows everything without scrolling (`scrollHeight <= innerHeight`);
    - at 360×640, the panel and the list end within the viewport;
    - the greeting font is Assistant 800.
  - Save the PNGs. The controller looks at them.

- [ ] **Step 7: Gate.** tsc, and eslint on the three files.
- [ ] **Step 8: Commit** with `feat(kitchen): Shabbat view from candle lighting to the end, polling unchanged`.

---

### Task 7: Settings: the Shabbat mode controls in the kitchen screen card

**Files:**
- Create: `src/components/settings/ShabbatModeSettings.tsx`
- Modify: `src/components/settings/KitchenScreenCard.tsx` (render `<ShabbatModeSettings groupId={groupId} />` after the recipe hint, before `kitchen.settings_hint`)
- Test: `$H/t7-settings.test.tsx` (server render of the presentational form), with tsconfig paths stubbing `@/hooks/useApi`, `@/hooks/useToast` and `@/hooks/useLang`. Copy the stubs from `$A/t7-*-stub.ts` into `$H` and make `$H/tsconfig-ui.json` from `$H/tsconfig.json` plus those three paths.

**Interfaces:**
- Consumes: `GET`/`PUT /groups/:id/shabbat` → `ShabbatSettings` (Task 4; import the type from `@/lib/shabbat-times` with `import type` only, so no server code reaches the bundle); `FAMCAL_CITIES`, `famcalCity` (Task 1); `COMMUNITIES` from `@/lib/famcal`. Use `import type { Community }` and keep a local `const COMMUNITY_KEYS = ['sephardi', 'ashkenazi', 'chabad'] as const`, so the client never imports `famcal.ts` (it pulls in p-retry and reads env).
- Produces:
  - `export function ShabbatModeSettings({ groupId }: { groupId: number })`, the stateful one;
  - `export function ShabbatModeForm(props: { settings: ShabbatSettings; pendingOn: boolean; saving: boolean; onToggle(next: boolean): void; onCity(slug: string): void; onCommunity(c: Community): void })`, the pure one.

- [ ] **Step 1: The component.**
  - **Loading:** on mount, GET `/groups/${groupId}/shabbat` with `apiFetch`.
    - While loading, show the switch row disabled (`aria-checked=false`, `disabled`).
    - **On failure:** log `[shabbat] settings load failed:` and show `<LoadError compact onRetry={load} />`. The failed flag clears only when a load succeeds (AGENTS.md rule).
  - **The switch row** (the recipe switch's exact markup and classes) with the label `t('kitchen.shabbat_mode')` and the hint `t('kitchen.shabbat_mode_hint')` (`text-xs text-muted-foreground`).
    - `aria-checked` is `settings.city !== null || pendingOn`.
  - **When on** (`city !== null || pendingOn`), show the city and community selects:
    - **The city select** (`<label className="flex flex-col gap-1.5">`, the select classes from `src/app/miniapp/settings/catalog/costs/page.tsx:386`):
      - a placeholder option `t('kitchen.shabbat_city_pick')`, only while city is null;
      - the `FAMCAL_CITIES` options;
      - while pending with no suggestion and `homeCity` set, the hint `t('kitchen.shabbat_city_not_found').replace('{city}', homeCity)`.
    - **The community select** with `t('kitchen.shabbat_community')` and the three `t('kitchen.shabbat_community_<c>')` options.
    - **While `saving`:** both selects and the switch are disabled, and `t('kitchen.shabbat_saving')` shows.
    - **The preview** when `settings.next`:
      - the occasion, if any, in `text-sm font-medium`;
      - two `text-sm` lines from `t('kitchen.shabbat_preview_time')`: label `t('kitchen.shabbat_candles')` with day `formatWeekdayShort(israelDateStr(new Date(next.start)))` and the start's time; then label `next.endName` with the end's day and time;
      - the times inside `<span dir="ltr">`, using the same Israel clock formatter as `KitchenScreenCard`'s `clock`.
    - **The credits** under the preview: `<div dir="ltr" className="text-[10px] leading-snug text-muted-foreground">`, one `<p>` each.
  - **Actions:**
    - **Toggle on:** if `suggestedCity`, call `save(suggestedCity, settings.community)`; else `setPendingOn(true)`.
    - **Toggle off:** if `pendingOn && settings.city === null`, `setPendingOn(false)`; else `save(null, settings.community)`.
    - **City change:** `save(slug, settings.community)`.
    - **Community change:** if `settings.city`, `save(settings.city, c)`; else keep it locally for the coming save.
  - **`save(city, community)`:**
    - `setSaving(true)`;
    - `const next = await apiFetch<ShabbatSettings>(`/groups/${groupId}/shabbat`, { method: 'PUT', body: JSON.stringify({ city, community }) })`;
    - `setSettings(next); setPendingOn(false)`;
    - **On error:** log `[shabbat] save failed:`. Toast `t('kitchen.shabbat_no_key')` for status 503, `t('kitchen.shabbat_famcal_failed')` for 502, else `t('settings.save_failed')`. The settings stay as they were, so the controls revert.
    - `finally setSaving(false)`.

- [ ] **Step 2: Tests,** `$H/t7-settings.test.tsx`, server-rendering `ShabbatModeForm` with sample settings:
  1. **Off,** not pending → switch `aria-checked="false"`, no `<select`.
  2. **Pending,** no suggestion, homeCity 'גבעת זאב' → 2 selects, the placeholder 'בחרו עיר', the not-found hint with 'גבעת זאב'.
  3. **On** with `city:'beit-shemesh'` → the selected option is `בית שמש`, the community `ספרדי` is selected, the preview lines contain 'הדלקת נרות: ' and the times in `dir="ltr"`, the credits are there.
  4. **`saving`** → `disabled` on both selects and the switch, and 'מעדכן זמנים מ־famcal…' shows.
  5. **No raw `kitchen.` keys.**

  Also render `KitchenScreenCard` once (it shows the loading switch) to prove it still renders with the new child.
- [ ] **Step 3: Gate.** tsc, and eslint on the two files.
- [ ] **Step 4: Commit** with `feat(settings): Shabbat mode switch, city and community for the kitchen screen`.

---

### Task 8: Docs

**Files:** `AGENTS.md`

- [ ] **Step 1:** Add a bullet to AGENTS.md after the kitchen screen bullet:
  > The kitchen screen's Shabbat mode takes every time from famcal's Jewish times API (https://famcal.bot, the owner's own app; `FAMCAL_API_KEY`) through `src/lib/famcal.ts` only. The fetched stretches live in `shabbat_times` (`src/lib/shabbat-times.ts`), refreshed by the morning cron, which warns once they reach less than 8 days ahead. A save fetches first and writes nothing on failure. The screen shows `ShabbatScreen` from candle lighting to the end by its own clock (`src/lib/shabbat-view.ts`), and polling never stops on Shabbat.
- [ ] **Step 2: Commit** with `docs: Shabbat mode in AGENTS.md`.

---

## Final verification (controller)

- **Every test:** `for f in $H/t*.test.ts*; do $H/run.sh $f; done`. All exit 0.
- **Deliberate code breaks** (break each, run the owning test, see it fail, restore):
  - `activeBlock` with `now <= end`;
  - `greetingFor` checking chag before Yom Kippur;
  - the retry on a 4xx;
  - the refresh's write without its city condition;
  - `readShabbatTimes` without the mismatch check;
  - `KitchenScreen` not stopping at `end`.
- **The gate:** `npx tsc --noEmit`, `pnpm exec eslint .` and the offline build `build.sh shabbat-build`.
- **One final Opus review** of the whole branch against the spec and this plan.
