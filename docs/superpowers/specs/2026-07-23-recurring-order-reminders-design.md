# Recurring-Order Weekly Reminders — Design

**Date:** 2026-07-23
**Status:** approved (design decisions confirmed by owner)

## Goal

Automatically remind every customer who has an active recurring (standing)
order, ahead of each delivery, with the `order_recurring_reminder` WhatsApp
template — twice a week, fully hands-off.

**Bundled foundation:** a small cross-cutting change — a per-phone "receives
automatic messages" flag consulted by *every* automatic message path (see
"Phone targeting"). It stands on its own and could ship first; the recurring
reminder builds on it.

## Owner-confirmed decisions

- **Trigger:** automatic (scheduled), not a manual list.
- **Cadence:** two runs per week — **Sunday** and **Wednesday**, ~10:00.
- **Day split:** the Sunday run reminds deliveries **Mon–Wed**; the Wednesday
  run reminds deliveries **Thu–Sun**. (Each run only covers days that come
  *after* it, so no customer is reminded the same morning as delivery; the
  Friday/shabbat peak is reminded Wednesday = 2 days ahead.)
- **On/off:** a per-group master toggle (`groups.recurringRemindersEnabled`,
  default **off**) gates the whole feature. It ships dark — route + schedule
  live, sending nothing — until the owner flips it on once the template is
  registered and smoke-tested. Also the vacation / cost-control pause switch.
- **Phone targeting:** a per-phone `notify` flag (default **on**) on each
  customer decides which of their numbers receive **all** automatic messages
  (order confirmations, ready, cancelled, reminders, recurring), via one shared
  `getNotifiablePhones` helper. Phone-explicit manual sends override it. See
  "Phone targeting" below.
- **No header image** on the recurring reminder (text only). Hardcoded.

## Existing pieces (reused, not rebuilt)

- **Recurring orders:** `orders.isRecurring` + self-perpetuating
  clone-on-delivered (`createNextRecurringOrder`). Each active recurring order
  carries its own `orders.deliveryDate` (`'YYYY-MM-DD'` string). *Active* =
  `isRecurring = true AND status NOT IN ('delivered','cancelled')`.
- **WhatsApp send:** `sendWhatsAppTemplate(to, name, 'he', params?, headerImageUrl?)`
  (`src/lib/whatsapp.ts:32`) already builds Meta's positional body-parameter
  payload (`{{1}}`). Proven end-to-end by `order_received`
  (`src/app/api/orders/route.ts:238`).
- **Reminder infra:** `reminderTemplates` (occasion enum), `reminderSends` log
  (`templateId` NOT NULL), `customers.reminderOptOut`, round-robin
  `pickNextTemplate` (`src/lib/reminders.ts`). Today it is **manual-only** via
  `/api/reminders/send` + `SendReminderSheet`, and that path currently passes
  `params = undefined` ("no template variables for now").
- **Cron:** external **Upstash QStash** hits `/api/cron/*` with
  `Authorization: Bearer ${CRON_SECRET}`; routes export `GET` + `POST`,
  `maxDuration = 60`, and loop over all groups. `vercel.json` is `{}` (native
  Vercel Cron not used). Existing routes: `cron/morning-reminder` (daily 06:00),
  `cron/weekly-summary` (Sat 21:00). Both message **staff via Telegram** — none
  send WhatsApp to customers.
- **Item → Hebrew string:** `formatItemLine(qty, typeName, sizeLabel, additions)`
  (`src/lib/order-display.ts:15`) — customer-facing, **no weight**.

## Hard constraint: no newline inside `{{1}}`

Meta's Cloud API rejects body **parameters** that contain raw newlines / tabs /
4+ spaces (error 132000). The template body itself may contain newlines — so
`order_recurring_reminder` renders as:

```
ההזמנה הקבוע שלכם:
{{1}}
🍞
```

…where `{{1}}` is a **single comma-joined line** of the order's items, e.g.:

```
ההזמנה הקבוע שלכם:
2 חלה גדולה (עם שומשום), 1 לחם כפרי בינוני
🍞
```

This matches the format `order_received` already uses.

## Schedule & windows

One **daily** QStash schedule at **10:00 Asia/Jerusalem** → `POST
/api/cron/recurring-reminder`. The route no-ops unless the weekday (Jerusalem)
is Sunday or Wednesday. Keeping the day logic in versioned code (rather than two
dashboard schedules) means one external schedule to create and testable routing.

Each run covers **tomorrow through the day before the next run** — a contiguous
`deliveryDate` range queried with the dashboard's `gte`/`lte` string-range
pattern:

| Run day        | deliveryDate window        | Covers            | Shabbat lead |
| -------------- | -------------------------- | ----------------- | ------------ |
| Sunday (wd 0)  | `[today+1 .. today+3]`     | Mon, Tue, Wed     | —            |
| Wednesday (wd 3)| `[today+1 .. today+4]`    | Thu, Fri, Sat, Sun| 2 days (Fri) |

## Route behavior — `/api/cron/recurring-reminder` (per group)

1. **Auth:** `Authorization: Bearer ${CRON_SECRET}` else 401. Export `GET`+`POST`,
   `maxDuration = 60` (copy `cron/morning-reminder`).
2. **Run-day gate:** compute Jerusalem weekday; if not Sun/Wed → `200
   {skipped: 'not a run day'}`. Otherwise derive the `[start,end]` window above.
3. Loop groups. For each group:
   1. **Toggle gate:** skip the group unless `groups.recurringRemindersEnabled`.
   2. Load **active** `reminderTemplates` with `occasion = 'recurring'`. None →
      skip group (owner hasn't configured the template).
   3. Query candidate orders: `isRecurring = true`, `status NOT IN
      ('delivered','cancelled')`, `deliveryDate BETWEEN start AND end`, joined to
      `customers` where `reminderOptOut = false` (and `isActive = true`).
   4. For each candidate order:
      - **Dedup:** skip if a `reminderSends` row with `occasion = 'recurring'`
        exists for this customer with `sentAt` since start-of-today (Jerusalem).
        Guards against QStash retries / double-fires. (Runs are ≥3 days apart and
        each customer's delivery lands in exactly one window, so this never
        suppresses a legitimate weekly send.)
      - Build `{{1}}` = the order's items via `formatItemLine`, comma-joined
        (see the shared helper below).
      - Resolve the customer's notifiable phones via `getNotifiablePhones` (see
        "Phone targeting"); none → skip.
      - `pickNextTemplate` (last `recurring` templateId for this customer, for
        forward-compatibility with multiple templates), then for **each**
        notifiable phone → `sendWhatsAppTemplate(phone, metaTemplateName, 'he',
        [summary])` (no header image) + insert a `reminderSends` row
        (`occasion='recurring'`, `templateId`, `status='sent'|'failed'`).
4. Return aggregated `{ sent, failed, skippedOptOut, skippedDup }` and
   `console.error` failures — same reporting shape as the existing crons.

## Shared helper (avoid a third copy)

The persisted-order → items read pattern is already written twice
(`order-status.ts:90-116`, `order-recurring.ts:146-172`). Extract a single
customer-facing helper and reuse it:

```
// src/lib/order-display.ts (or order-recurring.ts)
export async function buildOrderItemsSummary(orderId: number): Promise<string>
// joins orderItems→breadTypes/breadSizes, loads orderItemAdditions ordered by
// breadAdditions.sortOrder, maps formatItemLine, returns a comma-joined line.
```

## Phone targeting — shared across all automatic messages

Owner-confirmed: pick, **per customer**, which numbers receive automatic
messages; that choice governs **every** automatic message (not per-feature).

- **Schema:** add `customerPhones.notify` (`boolean`, NOT NULL, default `true`).
  Default-true preserves today's behavior (all numbers messaged) until the owner
  unchecks some — no silent drop of a number that's currently getting messages.
- **Helper:** `getNotifiablePhones(customerId): Promise<string[]>` in
  `src/lib/customer-phones.ts` (beside `getCustomerPhones`) — phone strings where
  `notify = true`, ordered by `sortOrder`. All-off → empty → no automatic
  message (a valid "don't auto-message this customer" choice; respected, not
  overridden with a fallback).
- **Rewire every automatic sender through it** (this is the cross-cutting part):
  - `order_received` (`src/app/api/orders/route.ts`) — was all phones.
  - `order_ready` / `order_cancelled` (`order-status.ts` → `notifyCustomerWhatsApp`).
  - Manual **bulk-by-customer** reminders (`/api/reminders/send`, `customerIds`
    path) — honors `notify`.
  - The recurring-reminder cron.
  - **Override:** a phone-explicit manual send (`/api/reminders/send`, `phoneId`
    path) goes to that number regardless of `notify` — the owner's on-the-spot
    pick wins.
- **UI:** a "receives messages" checkbox per phone, where a customer's phones are
  already added/edited. Default checked.
- **Interaction with `reminderOptOut`:** `notify` is the universal per-phone
  gate; `customers.reminderOptOut` remains an additional customer-level gate on
  reminder-type messages only. A message is sent only if the phone is notifiable
  *and* (for reminders) the customer isn't opted out.

## Data / schema changes

- Add `groups.recurringRemindersEnabled` (`boolean`, NOT NULL, default `false`)
  — the master on/off, mirroring the existing `deliveryEnabled` opt-in column.
- Add `customerPhones.notify` (`boolean`, NOT NULL, default `true`) — the
  per-phone automatic-message gate (see "Phone targeting").
- Add `'recurring'` to `reminderOccasionEnum` (`src/db/schema.ts:69`) → generated
  Drizzle migration (runs automatically on deploy).
- Add `'recurring'` to the **template-CRUD** zod enums
  (`reminder-templates/route.ts`, `reminder-templates/[id]/route.ts`) so the owner
  can create/manage the template row under this occasion.
- **Not** added to `/api/reminders/send`'s zod (that manual path can't build the
  per-order `{{1}}`) — `recurring` is auto-only.
- `reminderSends` columns unchanged; reused as both the audit log and the dedup
  source.

## UI

- **תזכורות** (reminders settings) tab:
  - An **on/off toggle** for the whole feature (writes
    `groups.recurringRemindersEnabled`), with a one-line note on the Sun/Wed
    ~10:00 cadence.
  - Add `recurring` to the occasion selector with a short hint that this
    occasion is **sent automatically**. The owner registers the
    `order_recurring_reminder` template here (label + metaTemplateName + active).
- **`SendReminderSheet`**: do **not** offer `recurring` as a manual "send now"
  occasion — it needs a per-order `{{1}}` the manual path cannot produce.

## Configurability — what is a setting vs. hardcoded

Deliberately minimal (this is a single-bakery personal app; every knob is UI
surface + a way to misconfigure). Recorded so the choice is intentional:

| Parameter | Decision | Rationale |
| --- | --- | --- |
| Master on/off | **Setting** (`recurringRemindersEnabled`) | The pause switch; must not require deleting the template/schedule |
| Send time (10:00) | Hardcoded | Real trigger is the QStash schedule; a UI time couldn't move when QStash fires |
| Run days (Sun/Wed) | Hardcoded | Set-once; a one-line change if ever needed |
| Day-split windows | Hardcoded | Chosen once; not worth a config screen |
| Message wording | Already editable | Meta template + editable `reminderTemplates` row |
| Skip a customer | Already exists | `customers.reminderOptOut` |
| Phone targeting | **Per-phone flag** (`customerPhones.notify`) | You pick which numbers; one rule for every automatic message |
| Header image | Hardcoded (none) | A text nudge needs no photo |

Future (not now): a unified "automated messages" settings section could host
per-message toggles for this + the morning/weekly summaries; and a "send a test
to my number" button would ease smoke-testing a cron-only feature.

## Edge cases

- **Two recurring orders, same window:** one reminder that day (dedup by
  customer/day). Rare. Two orders in *different* windows (e.g. Tue + Fri) → each
  reminded on its own run day. Fine.
- **`deliveryDate` null (asap):** excluded by the range; also `isRecurring` is
  cleared for asap orders.
- **No recurring template configured:** group silently skipped (setup gate).
- **Cost:** each send is a billed template; opt-out + dedup + once-weekly
  cadence bound it.

## Verification

`npx tsc --noEmit` + `npx next build` (no test runner). Manual: POST the route
locally with the Bearer secret against seeded Sun/Wed dates; assert
`reminderSends` rows and log the composed `{{1}}`. Because the phone-targeting
change touches **live** paths, also confirm `order_received`/`order_ready` still
reach the expected numbers with `notify` defaulting on, and that unchecking a
number drops it from every automatic message.

## Owner ops (post-deploy, not code)

1. Register the `order_recurring_reminder` template row in the תזכורות tab
   (occasion = recurring, metaTemplateName = `order_recurring_reminder`, active).
   The Meta template is already approved with one body variable.
2. Create **one** QStash schedule: daily **10:00 Asia/Jerusalem** → `POST
   https://<app>/api/cron/recurring-reminder`, header `Authorization: Bearer
   <CRON_SECRET>`.
3. **Flip the on/off toggle on** in the תזכורות tab (ships off).
4. Smoke-test on a Sunday or Wednesday.
