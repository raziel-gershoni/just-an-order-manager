# Income Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `דוחות` Control Center tab showing a calendar year's money by month (מחזור / תקבולים / owed), units per bread and per-customer totals, with a five-sheet RTL `.xlsx` download for the accountant.

**Architecture:** Computed live from the `payments` ledger and delivered orders on every request (no table, no migration). One server module runs four read-only raw-SQL aggregates and folds them in JS. A client-safe types module is shared by the screen, the API and the spreadsheet builder. The download reuses the signed export token, now bound to a purpose.

**Tech Stack:** Next.js 16 route handlers (Node runtime), Drizzle `db.execute(sql…)` over neon-http, `write-excel-file` 4.1.1 (`/node`), React 19 client page, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-13-income-report-design.md`

## Global Constraints

- Never connect to, query or write the production database; there is no other. SQL is verified in PGlite only.
- Never run `npm run build` (it migrates production) or `db:*` scripts. `npx next build` is fine.
- The repo is public: no real customer names, phones, ids or amounts in code, comments, fixtures or commit messages.
- Package manager is **pnpm** (`pnpm add`), not npm.
- Israel time is `(created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem'`; year bounds are `(make_timestamp(y,1,1,0,0,0) AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'UTC'`.
- Only integers or strings go into `sql` templates, never JS `Date`s.
- Money is summed in agorot (integers).
- Role gate is an allow-list: `role !== 'owner' && role !== 'manager'` → 403.
- `dir="ltr"` wraps only `₪` + digits, on an inline span that is not a grid or flex item.
- The Hebrew word for billed is `מחזור` (`general.turnover`), never `הכנסות`.
- The xlsx holds values only, no formulas, and an ASCII filename `income-YYYY.xlsx`.

## Review Focus

1. **A charge at 23:30 Israel time on the last day of a month.** It must land in that month, in both summer (UTC+3) and winter (UTC+2). The PGlite test pins both.
2. **A customer who owed money on Dec 31 and paid in the next year.** In the past year's report they must show a non-zero closing debt. The PGlite test pins the closing balance for a past year.
3. **A print-sheet token** (no purpose) pasted into the income file URL must get 401. The token test pins it.
4. **A baker or driver** must not see the tab, and the API must answer 403. That needs a code review of the allow-list in all three routes plus the tab filter.
5. **A five-tab bar at a 320px viewport** must not overflow or wrap. A headless-Chrome fixture pins it.

---

### Task 1: Purpose-bound export token

**Files:**
- Modify: `src/lib/export-token.ts`
- Test: `<scratchpad>/pgtest/token.test.ts` (scratchpad, not committed)

**Interfaces:**
- Produces: `signExportToken(groupId: number, ttlSeconds = 300, purpose?: string): string` and `verifyExportToken(token: string, purpose?: string): number | null`. With no purpose, the HMAC input is unchanged (`${gid}.${exp}`). With a purpose, it is `${purpose}:${gid}.${exp}`. The unpurposed payload never contains `:`, so the two cannot collide.

- [ ] **Step 1: Write the test.** It runs with `TELEGRAM_BOT_TOKEN=test` and checks five things:
  - an unpurposed sign verifies unpurposed and returns the gid;
  - a purposed sign verifies with the same purpose;
  - a purposed token fails unpurposed verification;
  - an unpurposed token fails purposed verification;
  - a token for purpose A fails for purpose B.
- [ ] **Step 2: Run it.** It fails, because the purpose parameter does not exist yet.
- [ ] **Step 3: Implement.** Use a `mac(payload, purpose?)` helper that both functions call. Keep the token format at three dot-separated parts.
- [ ] **Step 4: Run the test.** It passes. Run `npx tsc --noEmit`; the existing callers (print, catalog) still compile untouched.

### Task 2: Israel calendar helper + shared types

**Files:**
- Modify: `src/lib/date-utils.ts`. Add `israelToday(now = new Date()): { year; month; day }` using `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', … }).formatToParts`.
- Create: `src/lib/income-report-types.ts`. Holds `HEBREW_MONTHS`, `AUTO_CHARGE_SINCE = '2026-04-28'`, the `IncomeMonth`, `IncomeBread`, `IncomeCustomer`, `IncomeTotals` and `IncomeReport` interfaces (fields exactly as in the spec's definitions), `formatAgorot(agorot, { round? })`, `formatIsoDate(iso)` and `formatIsraelDateTime(iso)`. No database import.

- [ ] **Step 1: Test the edge instants.** `israelToday(new Date('2026-09-30T21:00:00Z'))` returns 2026-10-01, and `israelToday(new Date('2026-12-31T22:30:00Z'))` returns 2027-01-01.
- [ ] **Step 2: Test the formatter.** `formatAgorot(123450)` returns `₪1,234.50`, `formatAgorot(123400)` returns `₪1,234`, `formatAgorot(-5000)` returns `-₪50`, and `formatAgorot(123450, { round: true })` returns `₪1,235`.

### Task 3: Report queries — `src/lib/income-report.ts`

**Interfaces:**
- Produces: `parseReportYear(raw: string | null): number | null`; `buildIncomeReport(groupId: number, year: number): Promise<IncomeReport>`; `buildIncomeTransactions(groupId: number, year: number): Promise<IncomeTransaction[]>`; `INCOME_REPORT_TOKEN = 'income-report'`; and the type `IncomeTransaction { at: string /* "YYYY-MM-DD HH:MM" Israel */; customerId; customerName; type: 'charge'|'payment'|'adjustment'; agorot /* signed as stored */; orderId: number|null; deliveryDate: string|null; description: string|null }`.

The queries are raw SQL through `db.execute`, read with `(res as unknown as { rows }).rows`:

```sql
-- 1. ledger: per customer, per bucket (0 = before the year), per type
with b as (
  select (make_timestamp(${year}::int, 1, 1, 0, 0, 0) at time zone 'Asia/Jerusalem') at time zone 'UTC' as y0,
         (make_timestamp(${year}::int + 1, 1, 1, 0, 0, 0) at time zone 'Asia/Jerusalem') at time zone 'UTC' as y1
)
select p.customer_id,
       case when p.created_at < b.y0 then 0
            else extract(month from (p.created_at at time zone 'UTC') at time zone 'Asia/Jerusalem')::int end as bucket,
       p.payment_type::text as type,
       sum(round(p.amount * 100))::bigint::text as agorot
from payments p cross join b
where p.group_id = ${groupId} and p.created_at < b.y1
group by 1, 2, 3;

-- 2. units: delivered orders dated in the year, per month, type and size
with o as (
  select id, coalesce(delivery_date, ((created_at at time zone 'UTC') at time zone 'Asia/Jerusalem')::date) as d
  from orders where group_id = ${groupId} and order_status = 'delivered'
)
select extract(month from o.d)::int as month, oi.bread_type_id, bt.name as type_name,
       oi.bread_size_id, bs.name as size_name, sum(oi.quantity)::int as units
from o join order_items oi on oi.order_id = o.id
join bread_types bt on bt.id = oi.bread_type_id
left join bread_sizes bs on bs.id = oi.bread_size_id
where o.d >= make_date(${year}::int, 1, 1) and o.d < make_date(${year}::int + 1, 1, 1)
group by 1, 2, 3, 4, 5;

-- 3. delivered order count per month (same CTE, group by month)
-- 4. meta: first ledger date (Israel), first delivery date, group name
-- 5. customers: id, name, is_active for the group
```

The JS fold:
- Build opening balances per customer from bucket 0. Build 12 flow slots per customer from the other buckets: `billed -= agorot` for charges, `received += agorot` for payments, `adjusted += agorot` for adjustments.
- Walk months 1…`lastMonth` with a running balance per customer. `lastMonth` is 12 for a past year, or `max(israel month, highest bucket seen)` for the current year.
- At each month end, `owedAtEnd = Σ max(0, −bal)` and `creditAtEnd = Σ max(0, bal)`.
- Per customer: `closing = opening − billed + received + adjusted`. Include a customer if they have any row in the year or a non-zero opening. Sort by billed desc, then by debt, then name (`he`).
- Breads are keyed by `typeId:sizeId|none`, with `byMonth[12]`. Sort by type total desc, then size total desc.
- `hasData` is `YYYY-MM >= dataStart.slice(0, 7)`. `billedIncomplete` is true when `dataStart < AUTO_CHARGE_SINCE`, `${year}-01-01 < AUTO_CHARGE_SINCE` and `${year+1}-01-01 > dataStart`.

- [ ] **Step 1: Write the PGlite harness** (`<scratchpad>/pgtest`).
  - Apply every `drizzle/*.sql` in journal order, split on `--> statement-breakpoint`, under `SET TIME ZONE 'UTC'`.
  - `tsconfig.json` paths map `@/db` to `./pgdb.ts`, which exports a Drizzle PGlite db with the repo schema, and map `@/*` to the repo's `src/*`.
  - Run it with `npx tsx --tsconfig <scratchpad>/pgtest/tsconfig.json report.test.ts`.
- [ ] **Step 2: Seed synthetic data.** Use made-up names only; every timestamp is naive UTC.
  - Group 1, customers A, B and C, with C inactive. Group 2 holds a decoy customer with its own rows.
  - A: a charge of ₪-100 on 2026-03-31 20:30 UTC (23:30 Israel time, UTC+3 summer), which must count in March. A payment of ₪60 on 2026-04-01 05:00 UTC.
  - A: a charge of ₪-50 on 2026-01-31 21:30 UTC (23:30 Israel time, UTC+2 winter), which must count in January.
  - B: a payment of ₪200 on 2025-12-15, so B opens 2026 with a ₪200 credit. A manual charge of ₪-80 with no order on 2026-05-10.
  - C: an adjustment of ₪+20 on 2026-06-01.
  - A: a charge of ₪-300 on 2026-12-31 20:00 UTC, which falls in Israel on 2026-12-31 22:00 and so belongs to 2026. A payment of ₪300 on 2027-01-05.
  - Orders:
    - delivered, `delivery_date` 2026-03-31, two items (one with a size, one with a null size);
    - delivered, `delivery_date` null, `created_at` 2026-02-28 22:30 UTC, which is March 1 in Israel time;
    - cancelled, in March, which must be excluded;
    - a decoy delivered order in group 2.
- [ ] **Step 3: Assertions.**
  - For year 2026, January billed is 5000, March billed is 10000 and April received is 6000.
  - The opening credit is 20000.
  - The 2026 closing balance is −39000 for A, 12000 for B and 2000 for C.
  - For year 2027, A's opening is −39000 and closing is −9000.
  - **The invariant:** Σ closing − Σ opening = received − billed + adjusted.
  - Units in March cover both delivered orders, with the null-size line as its own bread row.
  - The cancelled order and the group-2 rows are absent.
  - `dataStart` is `2025-12-15`, and `billedIncomplete` is true for 2026.
  - `parseReportYear` returns null for `'1999'`, `'abcd'` and next year, and returns the current year for null.
- [ ] **Step 4: Run.** All assertions pass.

### Task 4: Spreadsheet — `src/lib/income-report-xlsx.ts`

**Interfaces:**
- Consumes: `IncomeReport` and `IncomeTransaction[]`.
- Produces: `buildIncomeWorkbook(report, transactions): Promise<Buffer>`.

The workbook has five sheets, all `rightToLeft: true`, with sticky header rows on the four tables:
- **סיכום:** title, bakery name, generated time, the year's flows, opening and closing debts and credits, delivered orders and units, and the notes block from the spec.
- **חודשים:** one row per month. Months with no data are left empty. The total row sums the flows and repeats the closing balances.
- **לחמים:** type, size, the 12 months and a total, with a total row.
- **לקוחות:** id, name, active, opening debt (−balance), מחזור, תקבולים, התאמות, closing debt, with a total row.
- **תנועות:** date (a `Date.UTC` cell), time, customer id and name, type, then one of the charge, payment or adjustment columns, order number, delivery date and description, with a total row.

Money cells hold `agorot/100 || 0` with format `#,##0.00`. Text goes in as `type: String`.

- [ ] **Step 1:** In the PGlite harness, build the workbook from the seeded report and write it to the scratchpad.
- [ ] **Step 2:** Unzip it and check:
  - five `sheetN.xml` files, each with `rightToLeft="1"`;
  - no `<f>` element anywhere;
  - the sheet names in `workbook.xml`;
  - the summary values.

### Task 5: Routes

**Files:**
- Create: `src/app/api/reports/income/route.ts`. GET, returns the JSON report.
- Create: `src/app/api/reports/income/token/route.ts`. GET, returns `{ url, fileName }`.
- Create: `src/app/api/reports/income/file/route.ts`. GET, returns the xlsx and runs `verifyExportToken(token, INCOME_REPORT_TOKEN)`.

All three use the allow-list role check inside `withGroup`, except the file route, which is token-authorized. A bad year returns 400. The file route sends:
- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition: attachment; filename="income-YYYY.xlsx"`
- `Cache-Control: no-store`
- the body as `new Uint8Array(buffer)`.

- [ ] **Step 1:** Write the three routes.
- [ ] **Step 2:** `npx tsc --noEmit` passes.

### Task 6: Screen + tab

**Files:**
- Modify: `src/components/ui/ControlCenterTabs.tsx`. Add `{ href: '/miniapp/settings/reports', label: 'דוחות', adminOnly: true }` before `הגדרות`, and filter it out unless the role is owner or manager (`useGroup`).
- Modify: `src/lib/i18n.ts`. Add a `// Reports` block of `reports.*` keys.
- Create: `src/app/miniapp/settings/reports/page.tsx`.

The page has these states:
- If the role is known and is not admin, or the API returns 403, show the tabs and an `EmptyState(Lock)`.
- On the first load, show a skeleton.
- If the load failed, show a retry.
- If no month has data, show an empty state.
- A request counter drops stale responses when the year changes quickly.

Its body:
- **Year bar:** a ChevronRight button for the earlier year and a ChevronLeft button for the later one, bounded by `firstYear` and `currentYear`, plus a download button.
- **Summary card:** label rows with a dotted leader for מחזור, התקבל and the closing debt (`חוב פתוח היום` for the current year, otherwise `בסוף השנה`). An adjustments row appears only when the value is non-zero. A footnote shows the opening debt or credit when it is non-zero.
- **By-month card:** a grid of `minmax(0,1fr) 3.75rem×3`. Each month is a button row with a 3px bar under it (billed at `bg-primary/30` with received drawn over it, both sized against the year's best month). Tapping a month expands its orders, units and lines per bread. Months with no data show `—`. Cells are rounded to whole shekels. Every `Money` sits inside a plain span grid item.
- **Breads card:** each type with its total, and its sizes listed under it.
- **Customers card:** name, מחזור, התקבל and יתרה (red for debt, green for credit, `—` at zero). It shows the first 15 rows and a "show all" button.
- **Footnotes:** the legend, the data start date, and the incomplete-billing warning.

The download fetches the token URL first. Inside Telegram it calls `Telegram.WebApp.downloadFile({ url: origin+url, file_name })`. Otherwise it creates and clicks an `<a href download>`.

- [ ] **Step 1:** Implement the page.
- [ ] **Step 2:** Render it as a static fixture. Copy the compiled CSS from `.next/static/chunks/*.css` after `npx next build`, plus the page markup with sample data, into headless Chrome with `.theme-dark`, at a 375px content width and with the five-tab bar at 320px. Check for:
  - overflow;
  - digit isolation (₪ next to its digits);
  - right alignment in the RTL grid.

### Task 7: Verify, review, ship

- [ ] `npx tsc --noEmit`, `npx eslint` on the touched files, `npx next build`.
- [ ] A whole-branch review: find, then adversarially verify. Fix confirmed findings.
- [ ] Commit in logical units and push to `main`. Then update memory (`project_income_report.md` plus an index line).
