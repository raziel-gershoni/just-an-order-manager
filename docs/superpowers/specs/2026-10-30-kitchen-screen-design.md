# Kitchen screen — design

Approved in chat 2026-10-30.

## Goal

An old Android phone stands in the kitchen and always shows the coming work: the print sheet of
every day that has orders, in one long scroll, updated on its own when something changes. It is
view-only, because kids will reach it.

## Decisions (from the owner)

- A web page opened in Chrome and added to the home screen. No APK and no Telegram sign-in.
- Reuse the print view: each day shows its mixing weights, the baking count and each order's bag,
  exactly as printed (amounts and phones included).
- One long scroll, grouped by day:
  - the **בהקדם** (no date) group first, if it has orders;
  - then **today**;
  - then **every later day with orders**.
  - Past days are left out.
- Nothing on the screen changes anything.
- Refresh "only on change": the database is read only after a save, never on a timer.

## What the screen shows

- A day group is `buildPrintSheet(groupId, date)`: the same function as the print view, so the
  printout and the screen can never disagree. That means the dated-sheet rules apply: cancelled
  orders are hidden, and orders delivered that day stay with the **נמסר** stamp.
- The בהקדם group holds the open orders with no delivery date, with its baking count and bags.
  It has no mixing weights, which is the print view's own rule for undated sheets.
- **Today** is the Israel date (`israelTodayStr`), so the screen switches at midnight Israel time.
- **Layout:**
  - the print sheet's look, adapted for a phone: fluid width and larger text;
  - light or dark following the phone;
  - no print-only marks (the tick boxes);
  - each day starts with a clear, large heading.
- **Freshness line** at the bottom:
  - normally **עודכן HH:MM**, the time of the last successful check;
  - **אין חיבור · עודכן לאחרונה HH:MM** in red when checks fail.
  - So a stale sheet never passes as current.
- The page keeps the screen on with the Wake Lock API, and asks again whenever the page becomes
  visible.

## Connecting a phone (pairing)

- **Where:** Settings, in a new **מסך מטבח** section. Only owners and managers see it, matching
  who may print.
- **חבר מסך:**
  1. The server makes a random one-time code and stores its hash and an expiry 10 minutes ahead
     on the group.
  2. The app shows a QR code, plus a copyable link, for `/kitchen/pair?code=…`.
- **Opening the link:**
  1. One atomic `UPDATE … WHERE code_hash = $1 AND expires_at > now() RETURNING` clears the code,
     so a second open fails.
  2. The phone gets the screen cookie.
  3. It is redirected to `/kitchen`.
- **The screen cookie:**
  - It holds a signed token made with the existing `signExportToken`. The purpose is
    `kitchen:<group key version>` and the lifetime is 400 days.
  - It is httpOnly, secure and SameSite=Lax.
  - It is re-signed on every successful check, so it never runs out while the screen is in use.
- **What it can do:** it opens only `/kitchen` and its check endpoint, nothing else in the app.
- **נתק מסכים** (with a confirm) bumps the group's key version. Every connected screen then shows
  **המסך נותק** with one line on how to reconnect.
- **New columns on `groups`** (migration 0030):
  - `kitchen_key_version int not null default 0`;
  - `kitchen_pair_code_hash text`;
  - `kitchen_pair_expires_at timestamptz`.
- **Signing secret:** `TELEGRAM_BOT_TOKEN`, as for the print links. Rotating the bot token
  disconnects the screens, and that is acceptable.

## Refreshing only on change

**One write hook.** `src/db/index.ts` wraps the neon client that drizzle uses. After every
**successful** write statement, it marks the kitchen data stale with
`revalidateTag('kitchen', { expire: 0 })`.
- **Statements it watches:** insert, update, delete, including CTE writes sent with
  `db.execute`, and `db.batch`.
- **Why the client:** every save in the app (mini app, bot, crons) passes through it, so no save
  path can be missed, including future ones.
- **Invalidation is global**, not per table and not per group. A save that doesn't touch the sheet
  just causes one extra read, made while the database is awake anyway.
- **How it wraps:**
  - It wraps `query` and `transaction` on the neon client and returns the original
    `NeonQueryPromise`, so `db.batch`'s `instanceof` check still holds.
  - It fires after the request resolves, never on failure.
  - It detects writes from the SQL text, with comments and string literals stripped.
- **Where `revalidateTag` can't run** (scripts, a render, possibly `after()`), it logs one line and
  carries on. The safety re-read below covers those cases. The implementer checks in Next's
  source whether `after()` has a work store and states what they found.

**A saved copy.** Both the kitchen data and the key version are read through `unstable_cache`.
`use cache` needs `cacheComponents`, which this app doesn't enable.
- **Tag:** `kitchen`.
- **Cache key:** the group, the Israel date and the deployment id. A new day or a new deploy gets a
  fresh read once.
- **Safety re-read every 2 hours.** It covers the rare race where a read that started before a
  save is stored after it.

**What the phone does:**
1. Every 30 seconds, and immediately when the page becomes visible or the network returns, it calls
   `GET /api/kitchen/state`.
2. The endpoint checks the cookie and the cached version, and returns the cached copy's build stamp.
   It is tiny and never touches the database unless the copy is stale.
3. When the stamp changes, the page calls `router.refresh()` once to re-render the sheet from the
   cache.
4. A 401 shows the disconnected screen.

**Cost:**
- About 86,000 small Vercel calls a month, within the free plan.
- The database wakes only after real saves, at most every 2 hours for the safety re-read, at
  midnight, and once per deploy. That is at most about 8 CU-hours a month against the free 100.

## Home-screen install

- `/kitchen` has its own manifest (`start_url` and `scope` set to `/kitchen`, standalone, the
  app's icon). It is linked from the kitchen layout's metadata, so **Add to Home screen** opens
  straight into the screen.
- `noindex`.

## Code shape

- **`src/lib/kitchen-sheet.ts`:** `buildKitchenSheet(groupId, today)` returns the ordered day
  groups.
  - It loads the distinct delivery dates from today onwards that have non-cancelled orders, then
    builds `buildPrintSheet` per date.
  - The undated group comes from a new `undated` mode of the print sheet's own builder. Print
    behaviour stays unchanged.
- **`src/lib/kitchen-screen.ts`:** pairing (`startPairing`, `claimPairing`), `disconnectScreens`,
  token sign and verify, and the cached reads.
- **`src/components/print/SheetParts.tsx`:** the `MixSection`, `RecipeCard`, `OrderBlock` and
  baking-count blocks moved out of the print page **unchanged**. The print page imports them, so
  its output is identical.
- **Routes:**
  - `src/app/kitchen/layout.tsx` (manifest, noindex);
  - `page.tsx` (server-rendered sheets, or the not-connected / disconnected view);
  - a small client component for polling, the wake lock and the freshness line;
  - `pair/route.ts`;
  - `manifest.webmanifest/route.ts`;
  - `src/app/api/kitchen/state/route.ts`;
  - `src/app/api/groups/[id]/kitchen/route.ts` (POST pair, DELETE disconnect; owner and manager).
- **New user-facing strings** go into `src/lib/i18n.ts`. The print parts keep their existing inline
  Hebrew. Moving them is out of scope.
- **QR code:** an established QR library, picked in the plan after checking that it is maintained.

## Errors and logging

- Every caught failure logs with a `[kitchen]` prefix:
  - a bad or old cookie;
  - an expired or used code;
  - wake lock refused;
  - a check failing;
  - mark-stale unavailable.
- The pairing route explains an expired or used code on the page (**הקוד פג או כבר נוצל**), with
  how to get a new one.

## Verification (no prod data, no test runner)

- **tsx scripts with hand-written inputs:**
  - write detection: CTE writes, read-only CTEs, comments, string literals;
  - the client wrapper against a fake neon client: it fires only after success, `batch` still
    passes `instanceof`, nothing fires twice;
  - token sign and verify across a version bump;
  - day grouping.
- **PGlite with all migrations:**
  - `buildKitchenSheet` grouping and order;
  - atomic single-use pairing (the second claim fails, an expired code fails);
  - disconnect.
- **Print parts extraction:** render with a fixed fake sheet before and after, and compare the
  markup byte for byte.
- **Headless Chrome screenshots** of `/kitchen` against stubbed data: phone width, light and dark,
  disconnected view, offline line.
- **Gate:** `npx tsc --noEmit`, eslint, `node_modules/.bin/next build`.
- **Left for the owner's manual check:** pairing on the real phone, a change appearing within about
  30 seconds, and the screen staying on.

## Owner setup after deploy (given step by step then)

1. Connect the phone (Settings → מסך מטבח → חבר מסך, scan with the phone).
2. Chrome ⋮ → Add to Home screen.
3. Keep the phone charging.
4. Optional: developer options → Stay awake, and Samsung's Pin app.

## Non-goals

- Tapping to change orders.
- Telegram sign-in.
- An APK.
- Auto-start after a reboot.
- Separate named screens.
- Hiding amounts or phones.
- Per-table invalidation.
- Any change to the print view, including its UTC "today", which the owner hasn't decided on.
