# Delivery Route Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The deliveries screen shows open deliveries as one numbered list in least-driving order from home and back, re-sorted after each stop is marked delivered.

**Architecture:** Customer and home addresses are geocoded lazily by Google Geocoding and cached on their rows, keyed by the looked-up text. A new endpoint `GET /api/deliveries/route-order?from=<orderId>` asks Google Routes for one driving-time matrix, solves the stop order on the server, and returns order ids plus flags. The screen keeps its existing list fetch and applies the order. All pure logic (parsing Google answers, solving, the Maps link, planning) lives in DB-free modules so it can be exercised offline with injected fakes.

**Tech Stack:** Next.js 16 route handlers, Drizzle/Neon, zod/v4, p-retry, Google Geocoding API (JSON) and Routes API `computeRouteMatrix`.

**Spec:** `docs/superpowers/specs/2026-11-14-delivery-route-design.md`

## Global Constraints

- Server-only env var `GOOGLE_MAPS_API_KEY`; never `NEXT_PUBLIC_`, never logged, never sent to the browser.
- Geocoding: `https://maps.googleapis.com/maps/api/geocode/json?address=…&language=he&region=il&key=…`. "rough" = top result has `partial_match: true` OR `geometry.location_type === 'APPROXIMATE'`. `ZERO_RESULTS` = definitive "none" (cached). Any other non-OK status, HTTP error or network failure = error (never cached).
- Matrix: `POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`, headers `X-Goog-Api-Key`, `X-Goog-FieldMask: originIndex,destinationIndex,status,condition,duration`, body `{origins:[{waypoint:{location:{latLng:{latitude,longitude}}}}], destinations:[same], travelMode:'DRIVE', routingPreference:'TRAFFIC_UNAWARE'}`. Answer is a JSON array of elements; `duration` is a string like `"523s"`; `condition: 'ROUTE_NOT_FOUND'` or a non-empty `status.code` → unreachable pair. Max points in one request: 25 (25×25 = 625).
- Retries like `src/lib/famcal.ts`: p-retry, retries 3, factor 2, minTimeout 1000, randomize; retry network errors, HTTP 429/5xx, geocode `OVER_QUERY_LIMIT`/`UNKNOWN_ERROR`; abort on everything else. No artificial timeouts.
- Logs tagged `[google-maps]` / `[delivery-route]`, never addresses, names or the key.
- All user-facing strings in `src/lib/i18n.ts`, Hebrew reading natively. RTL correct; digits isolated with `dir="ltr"` only on the digits.
- Postgres reads that reach a user have an explicit `ORDER BY` with an id tie-break.
- Never run `pnpm build`/`npm run build`, any `db:*` script, drizzle-kit, or anything that reads `.env.local`. Never touch the prod DB.
- Offline gate: `npx tsc --noEmit`, `pnpm exec eslint .`, `DATABASE_URL=postgresql://u:p@fake.test/db NODE_OPTIONS="--require $S/wk/fakeneon.cjs" node_modules/.bin/next build` where `S=/private/tmp/claude-501/-Users-razielgershoni-development-just-an-orders-manager/210db9cb-6ed2-48f7-ad91-469826ed584c/scratchpad`.
- Tests are tsx scripts in `$S/route/` (not committed; the repo has no test runner), run with `node_modules/.bin/tsx --tsconfig $S/route/tsconfig.json $S/route/<file>.ts`. That tsconfig maps `@/*` to the repo's `src/*`. Google is never called: `fetch` is replaced with a fake.

## Review Focus

1. Two stops marked delivered in quick succession: the slower, older route answer must not overwrite the newer one (request sequence guard in the page).
2. The "delivered, but the payment failed" retry path keeps working; a failed payment must not trigger a re-sort that drops the card.
3. An order opened in the list but missing from the route answer (created between the two fetches) is still shown, never hidden.
4. A Google error on one customer's geocode must not cache "none" for that customer; the next open retries it.
5. A rough home address is still used as the start/end point; only "none" home gives `home_not_found`.

---

### Task 1: Columns, migration, Google client

**Files:**
- Modify: `src/db/schema.ts` (customers ~line 340, groups ~line 107)
- Create: `drizzle/0034_delivery_route.sql`; Modify: `drizzle/meta/_journal.json` (idx 34, `"when": 1793800000000`, tag `0034_delivery_route`)
- Create: `src/lib/google-maps.ts`
- Modify: `.env.example` (add `GOOGLE_MAPS_API_KEY=` with a one-line comment: Geocoding + Routes APIs, server only)
- Test: `$S/route/google-maps.test.ts`

**Interfaces:**
- Produces (schema, all nullable unless noted):
  - customers: `geoLat` `geo_lat` double precision; `geoLng` `geo_lng` double precision; `geoQuery` `geo_query` varchar(800); `geoRough` `geo_rough` boolean NOT NULL default false. `geoQuery` set with `geoLat` null means Google said "no results" for that text.
  - groups: `deliveryHomeAddress` `delivery_home_address` varchar(500); `homeGeoLat`, `homeGeoLng` double precision; `homeGeoQuery` varchar(800); `homeGeoRough` boolean NOT NULL default false.
- Produces (`src/lib/google-maps.ts`, server only):
  - `export type LatLng = { lat: number; lng: number }`
  - `export type GeocodeResult = { kind: 'found'; lat: number; lng: number; rough: boolean } | { kind: 'none' }`
  - `export class GoogleMapsError extends Error { constructor(readonly code: string, readonly status: number | null, message: string) }` — codes: `NO_KEY`, `NETWORK`, `BAD_ANSWER`, `HTTP_<n>`, or Google's geocode status.
  - `export function parseGeocode(body: unknown): GeocodeResult` — throws `GoogleMapsError` (with `retryable` decided by caller via code) on non-OK/non-ZERO_RESULTS.
  - `export function parseMatrix(body: unknown, n: number): number[][]` — n×n seconds, `Infinity` for unreachable pairs, `0` on the diagonal; throws `GoogleMapsError('BAD_ANSWER')` if any off-diagonal pair is missing.
  - `export function geocode(query: string): Promise<GeocodeResult>`
  - `export function driveMatrix(points: LatLng[]): Promise<number[][]>` — throws if `points.length > 25`.

- [ ] **Step 1: Write the failing test** `$S/route/google-maps.test.ts` with assertions:
  - `parseGeocode({status:'OK',results:[{geometry:{location:{lat:31.1,lng:34.2},location_type:'ROOFTOP'}}]})` → `{kind:'found',lat:31.1,lng:34.2,rough:false}`
  - same with `partial_match:true` → `rough:true`; with `location_type:'APPROXIMATE'` → `rough:true`; `GEOMETRIC_CENTER` without partial → `rough:false`
  - `{status:'ZERO_RESULTS',results:[]}` → `{kind:'none'}`
  - `{status:'OVER_QUERY_LIMIT'}` throws `GoogleMapsError` code `OVER_QUERY_LIMIT`; `{status:'REQUEST_DENIED'}` throws code `REQUEST_DENIED`; `"x"` throws `BAD_ANSWER`
  - `parseMatrix([{originIndex:0,destinationIndex:1,duration:'60s',condition:'ROUTE_EXISTS'},{originIndex:1,destinationIndex:0,duration:'75s',condition:'ROUTE_EXISTS'}],2)` → `[[0,60],[75,0]]`
  - an element with `condition:'ROUTE_NOT_FOUND'` → `Infinity`; one with `status:{code:5}` → `Infinity`; a missing pair → throws `BAD_ANSWER`
  - with `globalThis.fetch` faked: `geocode('x')` with no key → throws `NO_KEY`; with key and fake answering `OVER_QUERY_LIMIT` once then OK → returns found (retried); fake answering `REQUEST_DENIED` → throws after one call; the URL contains `language=he` and `region=il`
  - `driveMatrix` fake: asserts method POST, both headers present, body `routingPreference==='TRAFFIC_UNAWARE'`, returns parsed matrix; 26 points → throws.
- [ ] **Step 2: Run** `node_modules/.bin/tsx --tsconfig $S/route/tsconfig.json $S/route/google-maps.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** schema columns, migration (`ALTER TABLE … ADD COLUMN IF NOT EXISTS …` per column with `--> statement-breakpoint`, header comment like 0033), journal entry, `.env.example` line, and `src/lib/google-maps.ts` following famcal.ts's pRetry/AbortError structure and its header-comment style. Reduce test waits by passing p-retry options through a module-level `retryOptions` that the test may shorten (export `__setRetryMinTimeout(ms)` only if needed; otherwise accept ~1s waits).
- [ ] **Step 4: Run test** — Expected: all `ok`, exit 0. Also `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(delivery): geocode cache columns and Google Maps client`.

### Task 2: Solver, Maps link, geocode text

**Files:**
- Create: `src/lib/route-order.ts` (pure, no imports from db or google-maps; safe for client import)
- Test: `$S/route/route-order.test.ts`

**Interfaces:**
- Produces:
  - `export function geoQueryText(address: string | null | undefined, city: string | null | undefined): string | null` — trimmed parts joined `', '`, null when empty (same text `buildWazeLink` uses; refactor `buildWazeLink` in `src/lib/delivery.ts` to call it).
  - `export function solvePath(m: number[][], start: number, end: number, visit: number[]): number[]` — the order of `visit` minimising `m[start][v1] + … + m[vk][end]`; `start` and `end` may be equal (a round trip from home). Infinity treated as 1e9. Exact by trying every permutation when `visit.length <= 8`; above that nearest-neighbour then 2-opt on the open path until no improvement. Returns `[]` for empty `visit`.
  - `export function googleMapsDirUrl(stops: string[], home: string): { url: string; partial: boolean } | null` — null for no stops. ≤3 stops: `waypoints` = all, `destination` = home, `partial:false`. >3: `waypoints` = first 3, `destination` = 4th, `partial:true`. Base `https://www.google.com/maps/dir/?api=1`, params via `URLSearchParams`: `destination`, `waypoints` (joined `|`, omitted when empty), `travelmode=driving`, `dir_action=navigate`. No `origin`.

- [ ] **Step 1: Write the failing test** with assertions:
  - `geoQueryText(' רח׳ הזית 4 ', 'מושב')` → `'רח׳ הזית 4, מושב'`; `(null,'  ')` → `null`
  - 4-point asymmetric matrix where the greedy choice is wrong: `solvePath(m,0,0,[1,2,3])` equals the brute-force optimum computed in the test by enumerating all 6 orders
  - asymmetric check: a matrix where `[1,2,3]` and `[3,2,1]` differ in cost → returns the cheaper direction
  - `solvePath(m, 2, 0, [1,3])` starts from point 2 (cost counted from row 2)
  - an `Infinity` edge is avoided when a finite order exists
  - 11 random points (seeded, Euclidean): result is a permutation of the input and its cost ≤ the pure nearest-neighbour cost
  - `googleMapsDirUrl(['a','b'],'h')` → url has `destination=h`, `waypoints=a%7Cb`, `travelmode=driving`, `dir_action=navigate`, no `origin`, `partial:false`
  - 5 stops → `destination` = 4th, 3 waypoints, `partial:true`; `[]` → null
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `src/lib/route-order.ts`; make `buildWazeLink` use `geoQueryText`.
- [ ] **Step 4: Run** — Expected: all ok; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(delivery): route solver and Google Maps link`.

### Task 3: Planner and endpoint

**Files:**
- Create: `src/lib/delivery-route.ts` (DB-free planner, deps injected)
- Create: `src/lib/open-deliveries.ts` — `export function openDeliveriesWhere(groupId: number): SQL` (the `and(eq(orders.groupId…), eq(orders.isDelivery,true), notInArray(orders.status,['delivered','cancelled']))` from `src/app/api/deliveries/route.ts`); make that route use it
- Create: `src/app/api/deliveries/route-order/route.ts`
- Test: `$S/route/delivery-route.test.ts`

**Interfaces:**
- Consumes: Task 1 `geocode`, `driveMatrix`, `GeocodeResult`, `LatLng`, `GoogleMapsError`; Task 2 `geoQueryText`, `solvePath`, `googleMapsDirUrl`.
- Produces:
  ```ts
  export type RouteStatus = 'ok' | 'empty' | 'no_home' | 'home_not_found' | 'too_many' | 'failed';
  export type RouteAnswer = {
    status: RouteStatus;
    canManage: boolean;                         // owner/manager: the hint says "settings", else "ask the manager"
    stops: { orderId: number; rough: boolean }[]; // route order, one entry per order ([] unless ok)
    unplaced: number[];                          // order ids with no address or Google "none" (filled for ok)
    maps: { url: string; partial: boolean } | null;
  };
  export type GeoCache = { lat: number | null; lng: number | null; query: string | null; rough: boolean };
  export type PlanInput = {
    home: { text: string | null; cache: GeoCache };
    orders: { orderId: number; customerId: number; text: string | null; cache: GeoCache }[]; // ordered by deliveryDate, id
    from: { text: string | null; cache: GeoCache } | null; // the delivered stop's customer, already validated
  };
  export type PlanDeps = {
    geocode(text: string): Promise<GeocodeResult>;
    matrix(points: LatLng[]): Promise<number[][]>;
    saveCustomerGeo(customerId: number, text: string, r: GeocodeResult): Promise<void>;
    saveHomeGeo(text: string, r: GeocodeResult): Promise<void>;
  };
  export async function planRoute(input: PlanInput, deps: PlanDeps): Promise<Omit<RouteAnswer, 'canManage'> & { log: Record<string, number | string> }>;
  ```
- Planner rules (from the spec):
  1. No orders → `empty`. Home text null → `no_home`.
  2. Resolve a point for a text: cache hit when `cache.query === text` (found if lat/lng non-null, else none); otherwise call `deps.geocode`, then save (customer or home), then use. A geocode throw is not saved and makes the whole plan `failed`. Each customer is geocoded at most once per plan, and the lookups run concurrently (`Promise.all`).
  3. Home none → `home_not_found`. A rough home is used.
  4. Orders with null text or none → `unplaced` (input order kept).
  5. Places = distinct coordinates rounded to 5 decimals, in first-appearance order; a place is rough if any of its orders' customer is rough (they share coordinates so normally all equal).
  6. `from` gives the start point when its point resolves to found (rough allowed) and doesn't round to home; otherwise start = home. `from` geocoding follows rule 2.
  7. Points = [home, ...places, start (if not home)]. More than 25 → `too_many`. Matrix throw → `failed`.
  8. `solvePath(m, startIdx, 0, placeIndices)`; `stops` = each place's orders in input order; `maps = googleMapsDirUrl(place texts in order, home.text)` using each place's first order's text.
  9. `log` carries counts only: `orders, places, fresh, rough, unplaced, points, start:'home'|'stop'`.
- Endpoint `GET /api/deliveries/route-order`: `withGroup`; role owner/manager/driver else 403 (same as `/api/deliveries`); reads open deliveries with `openDeliveriesWhere` joined to customers, ordered exactly like the existing route (`asc(orders.deliveryDate), asc(orders.id)`); reads the group's home fields; `from` = query param, honoured only if that order has `groupId`, `isDelivery`, `status === 'delivered'`, then its customer's address/city/geo. Saves with `db.update(customers).set({geoLat,geoLng,geoQuery,geoRough}).where(and(eq(customers.id,id), eq(customers.groupId,groupId)))` and the groups equivalent. Logs `[delivery-route] group=… status=… ` + the `log` counts; errors logged with `GoogleMapsError.code`. Answers 200 with `RouteAnswer` for every status (failure is a status, not a 500), `canManage = role === 'owner' || role === 'manager'`.

- [ ] **Step 1: Write the failing test** for `planRoute` with fake deps (records calls), assertions:
  - no orders → `empty`; home text null → `no_home` and geocode never called
  - home geocode `none` → `home_not_found`; home `found, rough` → plan proceeds
  - three orders, two for the same customer → that customer geocoded once; their two order ids adjacent in `stops`
  - two customers at identical coordinates → one place (matrix size = places+1)
  - cache hit (`cache.query === text`) → geocode not called; changed text → geocode called and `saveCustomerGeo` called with the new text
  - cached none (`query === text`, lat null) → unplaced, geocode not called; null text → unplaced
  - geocode throws for one customer → `failed`, and `saveCustomerGeo` never called for that customer
  - matrix throws → `failed`; 25 places → `too_many` (26 points with home) and matrix not called
  - `from` found → matrix gets an extra last point and the solver starts there; `from` none or rounding to home → no extra point
  - order follows a fake matrix that makes the optimum obvious (e.g. home→B→A→C→home cheapest) → `stops` order B,A,C
  - `maps.url` destination is home's text for ≤3 places
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** planner, `openDeliveriesWhere` (and use it in `src/app/api/deliveries/route.ts`), and the endpoint.
- [ ] **Step 4: Run** test — all ok; `npx tsc --noEmit`; `pnpm exec eslint src/lib src/app/api/deliveries`.
- [ ] **Step 5: Commit** `feat(delivery): route-order endpoint`.

### Task 4: Home address setting

**Files:**
- Modify: `src/app/api/groups/[id]/route.ts` — `deliveryHomeAddress: z.string().max(500).nullable().optional()` in `updateGroupSchema`; owner/manager only (add to `DELIVERY_KEYS` is NOT allowed — that feeds `PUBLIC_KEYS` and the storefront; add a separate guard and copy into `updates`). Empty/whitespace saved as null. Saving never calls Google.
- Modify: `src/app/miniapp/settings/page.tsx` — state `delivHomeAddress`, loaded from `g.group.deliveryHomeAddress`, an `Input` right after the bakery-city input (always visible, like it), sent in `saveDelivery` as `deliveryHomeAddress: delivHomeAddress.trim() || null`.
- Modify: `src/lib/i18n.ts` — `'deliv.home_address': 'כתובת הבית (יציאה וחזרה במסלול המשלוחים)'`.
- Verify the public site never reads `deliveryHomeAddress` or `homeGeo*` (grep `src/app/(public)` / `src/lib/public-site*`); if any public code serialises the whole group row, select columns explicitly there.

- [ ] **Step 1:** Implement the above.
- [ ] **Step 2:** `npx tsc --noEmit`; `pnpm exec eslint src/app/api/groups src/app/miniapp/settings`. Grep shows no public reader of the new columns.
- [ ] **Step 3: Commit** `feat(delivery): home address setting`.

### Task 5: Deliveries screen in route order

**Files:**
- Modify: `src/app/miniapp/deliveries/page.tsx`
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Consumes: `RouteAnswer` type from `src/lib/delivery-route.ts` (type-only import), `formatDateRelative` from `src/lib/date-utils.ts`, `t('delivery.asap')`.

Behaviour:
- After `/deliveries` loads, fetch `/deliveries/route-order` (via `apiFetch`). The skeleton stays until both have answered (the route call failing counts as answered: status `failed`, logged with `[deliveries]`).
- A request sequence counter: only the latest route request's answer is applied.
- `complete(d, …)`: after the card is removed (same place it's removed today, i.e. only once the whole complete succeeded), drop `d.id` from the current route's `stops` locally, then refetch with `?from=${d.id}`. The payment-failed path (card stays) doesn't refetch.
- `status === 'ok'`: render one list. The Google Maps link sits above it as an outline button, the same styling as the Waze link, with a `Map` lucide icon (label `route.maps_all` or `route.maps_next` when `partial`). Then the cards in `stops` order with a stop number (1-based, `font-mono tabular-nums`, primary colour), then any loaded delivery missing from both `stops` and `unplaced` (no number), then a "בלי כתובת" section head in the existing dashed-rule style holding the `unplaced` cards.
  - Card tags next to the name, both small muted pills: the date tag (`deliveryDate == null` → `t('delivery.asap')`; `=== display.today` → none; else `formatDateRelative(date,'he')`) and, when the stop is `rough`, `t('route.check_address')`.
  - The card body is otherwise unchanged. Extract the existing card JSX into a local `DeliveryCard` component so both layouts share it.
- Any other status: today's date-grouped layout exactly as now, with a one-line muted note above it: `no_home` → `route.no_home` (canManage) / `route.no_home_driver`; `home_not_found` → `route.home_not_found`; `too_many` → `route.too_many`; `failed` → `route.failed`; `empty` → no note.
- i18n (Hebrew):
  - `'route.maps_all': 'נווט במסלול ב-Google Maps'`
  - `'route.maps_next': 'נווט ל-4 העצירות הבאות ב-Google Maps'`
  - `'route.check_address': 'לבדוק כתובת'`
  - `'route.unplaced': 'בלי כתובת'`
  - `'route.no_home': 'כדי לסדר את המשלוחים במסלול, הוסיפו כתובת בית בהגדרות המשלוחים'`
  - `'route.no_home_driver': 'כדי לסדר את המשלוחים במסלול, בקשו מהמנהל להוסיף כתובת בית בהגדרות'`
  - `'route.home_not_found': 'כתובת הבית לא נמצאה במפה. בדקו אותה בהגדרות המשלוחים'`
  - `'route.too_many': 'יותר מדי עצירות לחישוב מסלול, המשלוחים מוצגים לפי תאריך'`
  - `'route.failed': 'לא הצלחנו לחשב מסלול, המשלוחים מוצגים לפי תאריך'`

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `npx tsc --noEmit`; `pnpm exec eslint src/app/miniapp/deliveries`.
- [ ] **Step 3:** Render check: esbuild the page in a harness like `$S/kv` with a mocked `apiFetch` returning (a) ok with 3 stops incl. one rough, one tomorrow, one בהקדם, plus one unplaced; (b) `no_home` driver; screenshot both at 390px light and dark with headless Chrome. Expected: numbered 1–3, tags, "בלי כתובת" section, Maps button; (b) shows date groups and the driver hint.
- [ ] **Step 4: Commit** `feat(delivery): deliveries screen in route order`.

### Task 6: Docs, gate, review, push

- [ ] AGENTS.md: one line after the kitchen bullets: route order is computed by `/api/deliveries/route-order` (`src/lib/delivery-route.ts`), Google only through `src/lib/google-maps.ts` (`GOOGLE_MAPS_API_KEY`), geocodes cached on customers/groups keyed by the looked-up text.
- [ ] Spec status line → "approved 2026-11-15, shipped".
- [ ] Full offline gate (tsc, eslint, next build with fakeneon) passes; all `$S/route/*.test.ts` pass.
- [ ] Opus whole-branch review; fix every valid finding; re-run the gate.
- [ ] Commit, push, push notification; give the owner the Google Cloud setup steps.
- [ ] Delete this plan file once shipped (it's a stale plan after shipping).
