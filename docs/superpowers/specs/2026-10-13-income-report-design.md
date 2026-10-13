# Income Report — Design

**Date:** 2026-10-13
**Status:** approved approach A (live from the ledger); owner asked for autonomous build

The owner asked for "a monthly/yearly report on income", for two readers at
once: the accountant (annual filing) and the owner (is the business growing).
It is a screen in the app with a download the accountant opens as-is, and it
breaks the year down by bread and by customer on top of the money totals.

## Decisions

| Question | Decision |
|---|---|
| Purpose | Both: tax filing and business trends |
| Format | A screen in the app + an `.xlsx` download |
| Breakdown | Money by month, units per bread type/size, totals per customer |
| Architecture | **A** — computed live from `payments` on every request; no table, no migration, no cron |
| Period | Calendar year (= Israeli tax year), months cut in Asia/Jerusalem |
| Audience | Owner and manager only (allow-list), the same as the pricelist export |
| Placement | A fifth Control Center tab, `דוחות`, at `/miniapp/settings/reports`, hidden for other roles |

Rejected: a month-end snapshot table (B): a migration and a cron, and a late
correction would never reach the frozen month, so the report would quietly
disagree with the balances shown everywhere else. An export with no screen (C):
not what was asked.

## What the ledger can and cannot say

Facts the report is built on (read from the code on 2026-10-13):

- `payments.amount` is signed: `charge` rows are `−total`, `payment` rows are
  positive, `adjustment` rows are either. A customer's balance is `SUM(amount)`;
  negative means they owe.
- A charge is written once, when an order is marked delivered
  (`ensureOrderCharge`), and is never updated. Delivered orders cannot be edited
  or moved out of `delivered`. Staff can also enter a charge by hand on the
  payments screen, with no order attached. Twelve legacy charges have no order
  link at all. **Charges are therefore never joined to orders.**
- `created_at` is always the database `now()`, so nothing is backdated. A charge
  is dated when "delivered" was tapped, and a payment is dated when it was
  recorded, not when the money changed hands.
- The ledger is not append-only. Undoing ✅ deletes the payment row, so a filed
  month's `received` can drop later. That is the same ledger the balances read;
  the report agrees with them instead of freezing a copy.
- Before 2026-04-28 (commit `8fa628a`) a charge was only written when the
  payment dialog was completed, so `billed` for the first weeks of data is
  incomplete. The report says so for any year containing that date.
- `created_at` is `timestamp` without time zone holding UTC wall-clock (the Neon
  session is UTC; Drizzle writes `toISOString()`). Israel local time is
  `(created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem'`.
- No payment method, receipt number, VAT split or expense exists anywhere. The
  report does not invent them; the notes say so.

## Definitions

Scope: `payments.group_id = G`, `orders.group_id = G`. No `isActive` filter
anywhere — a deactivated customer's money is still money, and a retired bread
still sold. Amounts are summed in agorot (integers) and only formatted at the
edge.

```
IL(t)          = (t AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem'
bound(y)       = (make_timestamp(y,1,1,0,0,0) AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'UTC'
month(row)     = extract(month from IL(created_at)), for created_at in [bound(Y), bound(Y+1))

billed   מחזור    = Σ −amount  of type='charge'      in the month
received תקבולים  = Σ  amount  of type='payment'     in the month
adjusted התאמות   = Σ  amount  of type='adjustment'  in the month
balance(c, t)     = Σ amount of customer c's rows before t
owed(t)  חובות    = Σ −balance(c,t) over customers whose balance is < 0
credit(t) זכות    = Σ  balance(c,t) over customers whose balance is > 0
units    יחידות   = Σ order_items.quantity of orders with status='delivered',
                    by coalesce(delivery_date, IL(orders.created_at)::date),
                    per (bread_type_id, bread_size_id or none)
orders   הזמנות   = count of those orders
```

- `owed` and `credit` are point-in-time. They are taken at the opening of the
  year, at each month end, and at the close (Dec 31, or now for the current
  year). **They are never summed across months**; the year's figure is the
  closing value.
- Everything is derived from one per-customer, per-month aggregate, so
  `closing − opening = received − billed + adjusted` holds by construction, both
  per customer and in total.
- Units follow the delivery calendar, money follows the ledger calendar. They
  differ only for a delivery tapped late across a month boundary; the notes say
  so.
- A pack size (the legacy "six buns") counts as one unit, so the column is
  `יחידות`, not loaves.
- **Months before the group's first data** (first ledger row or first delivered
  order) show `—`, not ₪0. **Future months** of the current year are not shown.
  The current month is labelled `עד היום`. An order delivered ahead of a
  next-month delivery date is counted in the current month — it was handed over
  now, and a row for a month that hasn't started would invent its month-end
  balance.

## Data layer — `src/lib/income-report.ts`

`buildIncomeReport(groupId, year): Promise<IncomeReport>` runs four read-only
queries in parallel, all as raw SQL with integer parameters only (a JS `Date`
inside a `sql` template skips the column encoder and picks up the process time
zone):

1. **Ledger aggregate.** `customer_id`, bucket (`0` = before the year, else the
   Israel month 1–12), `payment_type`, `SUM(round(amount*100))`, for
   `created_at < bound(Y+1)`. `GROUP BY 1,2,3` positionally.
2. **Units.** Israel month, `bread_type_id`, `bread_size_id`,
   `SUM(quantity)` for delivered orders dated in the year, joined to current
   type and size names (inner join types, left join sizes), plus a delivered
   order count per month.
3. **Customers.** `id, name, is_active` for the group.
4. **Data start.** The earlier of the first ledger row (Israel date) and the
   first delivered order date.

neon-http gives every query its own snapshot, so the download reads the report
and the year's transactions together and compares their sums; if a write landed
between the reads it reads again (up to three times), so the transactions sheet
always adds up to the summary.

Everything else is plain JS over those rows: running balances per customer,
month-end owed and credit, per-customer opening, flows and closing, and the
bread list. `buildIncomeTransactions(groupId, year)` returns the year's ledger
rows (Israel timestamp, customer, type, amount, order id, the order's delivery
date, description) for the download only.

Shared, client-safe types and formatters live in `src/lib/income-report-types.ts`
(Hebrew month names, `formatAgorot`, the `IncomeReport` shape).

## API

All three routes use `withGroup` plus an **allow-list** role check
(`role !== 'owner' && role !== 'manager'` → 403). The year must be an integer
between 2000 and the current Israel year; it defaults to the current Israel
year.

- `GET /api/reports/income?year=YYYY` → the `IncomeReport` JSON.
- `GET /api/reports/income/token?year=YYYY` → `{ url }` with a signed token.
- `GET /api/reports/income/file?token=…&year=YYYY` → the `.xlsx`, as
  `income-YYYY.xlsx` (ASCII filename), `Cache-Control: no-store`.

**Token purpose.** Today a token signs only `groupId.exp`, so any print link (30
minutes, opened in an outside browser) would also open this report.
`signExportToken`/`verifyExportToken` gain an optional `purpose`. When it is
given it goes into the HMAC; when it is omitted the HMAC is unchanged, so
existing print and pricelist links keep working and cannot open the report.

## The download — `src/lib/income-report-xlsx.ts`

Built with `write-excel-file` (MIT, one dependency, per-sheet `rightToLeft`).
Values only, no formulas, because previews like Telegram's or iOS Quick Look
show formula cells blank. Five right-to-left sheets:

1. **סיכום** — bakery name, year, generated-at (Israel time), the year's
   מחזור / תקבולים / התאמות, owed and credit at opening and closing, and a notes
   block: amounts as recorded, by recording date, Israel time; charges include
   delivery fees and manual charges; received is dated when recorded; payment
   method only in descriptions; VAT not separated; not a receipt book; data
   start and the 2026-04-28 caveat when they fall in the year.
2. **חודשים** — month, delivered orders, units, מחזור, תקבולים, התאמות, owed at
   month end, credit at month end. The total row sums the flows and repeats the
   closing balances.
3. **לחמים** — bread type, size, January … December, total.
4. **לקוחות** — customer number, name, active, opening debt, מחזור, תקבולים,
   התאמות, closing debt. Debt is `−balance`, so a negative debt is a credit (said
   in the header note). Grouped by id, because names can repeat.
5. **תנועות** — every row of the year: date, time, customer, type, then one of
   חיוב / תקבול / התאמה, order number, the order's delivery date, description.
   Customer names and descriptions are written as string cells.

## The screen — `/miniapp/settings/reports`

Follows the Control Center tabs: no title bar, `<ControlCenterTabs />` first,
then the body. Copies the costs page's states: loading skeleton, denied
(`EmptyState` with a lock), load failed with retry.

```
[קטלוג][תזכורות][האתר][דוחות][הגדרות]
  ›  2026  ‹                     [⇩ לרואה החשבון]
 ┌───────────────────────────────────────────┐
 │ מחזור                          ₪48,210    │
 │ התקבל                          ₪45,900    │
 │ חוב פתוח היום                   ₪2,310    │
 │ ‏בתחילת השנה ₪0 · זכות ללקוחות ₪120        │
 └───────────────────────────────────────────┘
 לפי חודש ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
   חודש      מחזור     התקבל      חוב
   אוקטובר   ₪4,100   ₪3,800    ₪2,310   עד היום
   ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔                          (bar = מחזור / best month)
   ספטמבר …   (tap → 23 הזמנות · 140 יחידות, then units per bread)
 לחמים ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
   כפרי                              412
     גדולה 312 · קטנה 100
 לקוחות ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
   שם            מחזור    התקבל    יתרה
 הנתונים מתחילים ב-26/03/2026 · חיובים לפני 28/04/2026 חלקיים
```

- Year stepper bounded by the first data year and the current Israel year;
  ChevronRight steps back, as in the baker screen.
- The download uses the token URL in both cases: `Telegram.WebApp.downloadFile`
  inside Telegram, a plain `<a href download>` in a browser. `apiFetch` always
  parses JSON, so it cannot fetch the binary itself.
- The month bar is the one visual: a 3px track under each row, `מחזור` against
  the year's best month, with `התקבל` drawn over it. No chart library.
- Customer balance is signed as well as coloured, `-₪X` red for debt and `+₪X`
  green for credit, `—` at zero; a word would not fit a phone column, and colour
  alone fails a colour-blind reader. Sorted by מחזור, then by debt.
- An `התאמות` line appears only when the year has any.
- `dir="ltr"` wraps only the `₪` + digits; labels, separators and spaces stay in
  the Hebrew flow.

## Testing

No test runner and no database may be touched, so:

- **The SQL runs in PGlite** (real Postgres compiled to WASM) in the scratchpad.
  All repo migrations are applied, then synthetic data covers: a charge at 23:30
  Israel time on a month's last day in summer and in winter, a payment before the
  year (opening balance), a manual charge with no order, an adjustment, a
  credit-holding customer, an inactive customer, a delivered ASAP order with no
  delivery date, a null-size legacy line, a cancelled order (excluded), a second
  group (must not leak). The test calls the real `buildIncomeReport` through a
  path alias that swaps `@/db` for a PGlite-backed Drizzle, and asserts the
  invariant, the bucketing and the tenancy.
- **The xlsx** is generated from that report and read back.
- **The screen** is rendered as a static fixture against the compiled CSS in
  headless Chrome at phone widths, including the five-tab bar at 320 px.
- `npx tsc --noEmit`, `npx eslint`, `npx next build`. Never `npm run build`,
  which migrates production.

## Out of scope

Payment method, receipt or invoice numbers, VAT, expenses, write-offs, a
delivery-fee split, per-bread revenue (bundles are priced per order), custom
date ranges, Hebrew filenames, charts beyond the month bar, and locking a filed
year.
