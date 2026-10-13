import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { israelToday } from '@/lib/date-utils';
import {
  AUTO_CHARGE_SINCE,
  type IncomeBread,
  type IncomeCustomer,
  type IncomeMonth,
  type IncomeReport,
} from '@/lib/income-report-types';

// A calendar year's money, units and customers, read live from the ledger.
// See docs/superpowers/specs/2026-10-13-income-report-design.md.
//
// Two rules hold for every query in this file:
//  - `created_at` is a timestamp WITHOUT time zone holding UTC wall-clock, so
//    Israel time is `(created_at AT TIME ZONE 'UTC') AT TIME ZONE
//    'Asia/Jerusalem'` (one AT TIME ZONE, as in migration 0021, goes the wrong
//    way). Year bounds are Israel midnight turned back into naive UTC.
//  - Only integers go into the templates. A JS Date inside `sql` skips the
//    column encoder and is serialized in the process's time zone.

/** Binds an export token to this report, so a print link can't open it. */
export const INCOME_REPORT_TOKEN = 'income-report';

/** One ledger row of the year, for the spreadsheet's transactions sheet. */
export interface IncomeTransaction {
  /** Israel local time, "YYYY-MM-DD HH:MM". */
  at: string;
  customerId: number;
  customerName: string;
  type: 'charge' | 'payment' | 'adjustment';
  /** Signed as stored: charges are negative. */
  agorot: number;
  orderId: number | null;
  /** The linked order's delivery date, when there is one. */
  deliveryDate: string | null;
  description: string | null;
}

type Row = Record<string, unknown>;

async function rows(query: SQL): Promise<Row[]> {
  const res = await db.execute(query);
  return (res as unknown as { rows: Row[] }).rows ?? [];
}

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? null : String(v));

/**
 * A `?year=` value as a year this report can show, or null. Missing means the
 * current year. The future is refused: its months would only repeat today.
 */
export function parseReportYear(raw: string | null): number | null {
  const current = israelToday().year;
  if (raw == null || raw === '') return current;
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= 2000 && year <= current ? year : null;
}

// [start of year, start of next year) as naive-UTC bounds.
const yearBounds = (year: number) => sql`
  select (make_timestamp(${year}::int, 1, 1, 0, 0, 0) at time zone 'Asia/Jerusalem') at time zone 'UTC' as y0,
         (make_timestamp(${year}::int + 1, 1, 1, 0, 0, 0) at time zone 'Asia/Jerusalem') at time zone 'UTC' as y1
`;

// A delivered order's day: its delivery date, or — for an ASAP order delivered
// before delivery started stamping one — the Israel date it was written.
const deliveredOrders = (groupId: number) => sql`
  select id,
         coalesce(delivery_date, ((created_at at time zone 'UTC') at time zone 'Asia/Jerusalem')::date) as d
  from orders
  where group_id = ${groupId} and order_status = 'delivered'
`;

/** Per customer, per bucket (0 = before the year, else the Israel month), per type. */
function ledgerQuery(groupId: number, year: number) {
  return rows(sql`
    with b as (${yearBounds(year)})
    select p.customer_id,
           case when p.created_at < b.y0 then 0
                else extract(month from (p.created_at at time zone 'UTC') at time zone 'Asia/Jerusalem')::int
           end as bucket,
           p.payment_type::text as type,
           sum(round(p.amount * 100))::bigint::text as agorot
    from payments p cross join b
    where p.group_id = ${groupId} and p.created_at < b.y1
    group by 1, 2, 3
  `);
}

/** Units per Israel month, bread type and size, for orders delivered in the year. */
function unitsQuery(groupId: number, year: number) {
  return rows(sql`
    with o as (${deliveredOrders(groupId)})
    select extract(month from o.d)::int as month,
           oi.bread_type_id, bt.name as type_name,
           oi.bread_size_id, bs.name as size_name,
           sum(oi.quantity)::int as units
    from o
    join order_items oi on oi.order_id = o.id
    join bread_types bt on bt.id = oi.bread_type_id
    left join bread_sizes bs on bs.id = oi.bread_size_id
    where o.d >= make_date(${year}::int, 1, 1) and o.d < make_date(${year}::int + 1, 1, 1)
    group by 1, 2, 3, 4, 5
  `);
}

function ordersQuery(groupId: number, year: number) {
  return rows(sql`
    with o as (${deliveredOrders(groupId)})
    select extract(month from o.d)::int as month, count(*)::int as orders
    from o
    where o.d >= make_date(${year}::int, 1, 1) and o.d < make_date(${year}::int + 1, 1, 1)
    group by 1
  `);
}

function metaQuery(groupId: number) {
  return rows(sql`
    select
      (select min(((created_at at time zone 'UTC') at time zone 'Asia/Jerusalem')::date)::text
         from payments where group_id = ${groupId}) as first_ledger,
      (select min(d)::text from (${deliveredOrders(groupId)}) o) as first_delivery,
      (select name from groups where id = ${groupId}) as group_name
  `);
}

function customersQuery(groupId: number) {
  return rows(sql`select id, name, is_active from customers where group_id = ${groupId}`);
}

type Flow = { billed: number; received: number; adjusted: number };
const emptyFlows = (): Flow[] =>
  Array.from({ length: 12 }, () => ({ billed: 0, received: 0, adjusted: 0 }));

function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function owedAndCredit(balances: Iterable<number>): { owed: number; credit: number } {
  let owed = 0;
  let credit = 0;
  for (const b of balances) {
    if (b < 0) owed -= b;
    else credit += b;
  }
  return { owed, credit };
}

export async function buildIncomeReport(groupId: number, year: number): Promise<IncomeReport> {
  const today = israelToday();
  // Independent reads, and neon-http pays a round trip for each.
  const [ledger, unitRows, orderRows, meta, customerRows] = await Promise.all([
    ledgerQuery(groupId, year),
    unitsQuery(groupId, year),
    ordersQuery(groupId, year),
    metaQuery(groupId),
    customersQuery(groupId),
  ]);

  // Balance before the year, and the year's flows month by month, per customer.
  const opening = new Map<number, number>();
  const flows = new Map<number, Flow[]>();
  let lastBucket = 0;
  for (const r of ledger) {
    const customerId = num(r.customer_id);
    const bucket = num(r.bucket);
    const agorot = num(r.agorot);
    if (bucket === 0) {
      opening.set(customerId, (opening.get(customerId) ?? 0) + agorot);
      continue;
    }
    lastBucket = Math.max(lastBucket, bucket);
    let f = flows.get(customerId);
    if (!f) flows.set(customerId, (f = emptyFlows()));
    const slot = f[bucket - 1];
    if (r.type === 'charge') slot.billed -= agorot;
    else if (r.type === 'payment') slot.received += agorot;
    else slot.adjusted += agorot;
  }

  const isCurrentYear = year === today.year;
  // The months shown. A ledger row can still pull it one past today's month:
  // the server's clock and the database's may straddle the boundary by a moment.
  const lastMonth = isCurrentYear ? Math.min(12, Math.max(today.month, lastBucket)) : 12;
  // An order delivered ahead of its date keeps the later date. Showing it under
  // a month that hasn't started would invent a month-end balance for it; it was
  // handed over this month, so that is where it is counted.
  const monthOf = (r: Row) => Math.min(num(r.month), lastMonth);

  const ordersByMonth = new Array<number>(12).fill(0);
  for (const r of orderRows) ordersByMonth[monthOf(r) - 1] += num(r.orders);

  const unitsByMonth = new Array<number>(12).fill(0);
  const breadByKey = new Map<string, IncomeBread>();
  for (const r of unitRows) {
    const month = monthOf(r);
    const units = num(r.units);
    const breadSizeId = r.bread_size_id == null ? null : num(r.bread_size_id);
    const key = `${num(r.bread_type_id)}:${breadSizeId ?? 'none'}`;
    let bread = breadByKey.get(key);
    if (!bread) {
      bread = {
        breadTypeId: num(r.bread_type_id),
        breadTypeName: String(r.type_name),
        breadSizeId,
        sizeName: str(r.size_name),
        byMonth: new Array<number>(12).fill(0),
        total: 0,
      };
      breadByKey.set(key, bread);
    }
    bread.byMonth[month - 1] += units;
    bread.total += units;
    unitsByMonth[month - 1] += units;
  }

  const dataStart = earliest(str(meta[0]?.first_ledger), str(meta[0]?.first_delivery));
  const dataStartMonth = dataStart?.slice(0, 7) ?? null;
  // Walk the months with a running balance per customer. Owed and credit are
  // read at each month end — point-in-time figures, never added up.
  const running = new Map(opening);
  const months: IncomeMonth[] = [];
  for (let m = 1; m <= lastMonth; m++) {
    let billed = 0;
    let received = 0;
    let adjusted = 0;
    for (const [customerId, f] of flows) {
      const s = f[m - 1];
      billed += s.billed;
      received += s.received;
      adjusted += s.adjusted;
      running.set(customerId, (running.get(customerId) ?? 0) - s.billed + s.received + s.adjusted);
    }
    const { owed, credit } = owedAndCredit(running.values());
    const key = `${year}-${String(m).padStart(2, '0')}`;
    months.push({
      month: m,
      hasData: dataStartMonth != null && key >= dataStartMonth,
      billed,
      received,
      adjusted,
      owedAtEnd: owed,
      creditAtEnd: credit,
      orders: ordersByMonth[m - 1],
      units: unitsByMonth[m - 1],
    });
  }

  const names = new Map(customerRows.map((r) => [num(r.id), r]));
  const customers: IncomeCustomer[] = [...new Set([...opening.keys(), ...flows.keys()])]
    .map((customerId) => {
      const f = flows.get(customerId) ?? emptyFlows();
      const sum = (k: keyof Flow) => f.reduce((s, x) => s + x[k], 0);
      const openingBalance = opening.get(customerId) ?? 0;
      const billed = sum('billed');
      const received = sum('received');
      const adjusted = sum('adjusted');
      const row = names.get(customerId);
      return {
        customerId,
        name: row ? String(row.name) : `#${customerId}`,
        isActive: row ? Boolean(row.is_active) : false,
        openingBalance,
        billed,
        received,
        adjusted,
        closingBalance: openingBalance - billed + received + adjusted,
      };
    })
    // Someone whose account was settled before the year and stayed untouched
    // has nothing to report for it.
    .filter((c) => flows.has(c.customerId) || c.openingBalance !== 0)
    .sort(
      (a, b) =>
        b.billed - a.billed ||
        a.closingBalance - b.closingBalance ||
        a.name.localeCompare(b.name, 'he')
    );

  const typeTotals = new Map<number, number>();
  for (const b of breadByKey.values()) {
    typeTotals.set(b.breadTypeId, (typeTotals.get(b.breadTypeId) ?? 0) + b.total);
  }
  const breads = [...breadByKey.values()].sort(
    (a, b) =>
      (typeTotals.get(b.breadTypeId) ?? 0) - (typeTotals.get(a.breadTypeId) ?? 0) ||
      a.breadTypeName.localeCompare(b.breadTypeName, 'he') ||
      a.breadTypeId - b.breadTypeId ||
      b.total - a.total
  );

  const openingTotals = owedAndCredit(opening.values());
  const close = months[months.length - 1];
  const sumMonths = (k: 'billed' | 'received' | 'adjusted' | 'orders' | 'units') =>
    months.reduce((s, m) => s + m[k], 0);

  return {
    year,
    currentYear: today.year,
    firstYear: dataStart ? Math.min(Number(dataStart.slice(0, 4)), today.year) : today.year,
    isCurrentYear,
    currentMonth: isCurrentYear ? today.month : null,
    dataStart,
    billedIncomplete:
      dataStart != null &&
      dataStart < AUTO_CHARGE_SINCE &&
      `${year}-01-01` < AUTO_CHARGE_SINCE &&
      `${year + 1}-01-01` > dataStart,
    groupName: str(meta[0]?.group_name) ?? '',
    generatedAt: new Date().toISOString(),
    months,
    totals: {
      billed: sumMonths('billed'),
      received: sumMonths('received'),
      adjusted: sumMonths('adjusted'),
      orders: sumMonths('orders'),
      units: sumMonths('units'),
      openingOwed: openingTotals.owed,
      openingCredit: openingTotals.credit,
      closingOwed: close?.owedAtEnd ?? openingTotals.owed,
      closingCredit: close?.creditAtEnd ?? openingTotals.credit,
    },
    breads,
    customers,
  };
}

/** Every ledger row of the year, oldest first, for the spreadsheet. */
export async function buildIncomeTransactions(
  groupId: number,
  year: number
): Promise<IncomeTransaction[]> {
  const result = await rows(sql`
    with b as (${yearBounds(year)})
    select to_char((p.created_at at time zone 'UTC') at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI') as at,
           p.customer_id, c.name as customer_name, p.payment_type::text as type,
           round(p.amount * 100)::bigint::text as agorot,
           p.order_id, o.delivery_date::text as delivery_date, p.description
    from payments p
    cross join b
    join customers c on c.id = p.customer_id
    left join orders o on o.id = p.order_id
    where p.group_id = ${groupId} and p.created_at >= b.y0 and p.created_at < b.y1
    order by p.created_at, p.id
  `);
  return result.map((r) => ({
    at: String(r.at),
    customerId: num(r.customer_id),
    customerName: String(r.customer_name),
    type: String(r.type) as IncomeTransaction['type'],
    agorot: num(r.agorot),
    orderId: r.order_id == null ? null : num(r.order_id),
    deliveryDate: str(r.delivery_date),
    description: str(r.description),
  }));
}

function ledgerAgrees(report: IncomeReport, transactions: IncomeTransaction[]): boolean {
  let billed = 0;
  let received = 0;
  let adjusted = 0;
  for (const x of transactions) {
    if (x.type === 'charge') billed -= x.agorot;
    else if (x.type === 'payment') received += x.agorot;
    else adjusted += x.agorot;
  }
  return (
    billed === report.totals.billed &&
    received === report.totals.received &&
    adjusted === report.totals.adjusted
  );
}

/**
 * The report and its transactions, read so that they agree. neon-http sends
 * every query as its own request with its own snapshot, so a delivery marked or
 * a payment recorded between the two reads would leave the spreadsheet's
 * תנועות adding up to a different מחזור than its own summary, with nothing in
 * the file to explain it. Rather than trust the timing, compare the sums and
 * read again; the same race twice running is not something a bakery does.
 */
export async function buildIncomeExport(
  groupId: number,
  year: number
): Promise<{ report: IncomeReport; transactions: IncomeTransaction[] }> {
  for (let attempt = 1; ; attempt++) {
    const [report, transactions] = await Promise.all([
      buildIncomeReport(groupId, year),
      buildIncomeTransactions(groupId, year),
    ]);
    if (ledgerAgrees(report, transactions)) return { report, transactions };
    if (attempt === 3) {
      console.warn('[income-report] ledger kept moving during export', { groupId, year });
      return { report, transactions };
    }
  }
}
