/**
 * The income report's shape and formatting, shared by the screen, the API and
 * the spreadsheet — so nothing here may import the database.
 *
 * Money travels in agorot (integers) end to end and only becomes ₪ at the edge:
 * a year of `numeric` amounts summed as JS floats drifts.
 */

export const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
] as const;

/**
 * Until commit 8fa628a a charge was only written when the payment dialog was
 * completed, so a delivery marked from the bot, or with the dialog dismissed,
 * left none. מחזור before this day under-reports, and the report says so.
 */
export const AUTO_CHARGE_SINCE = '2026-04-28';

export interface IncomeMonth {
  /** 1–12. */
  month: number;
  /** False before the bakery's first recorded activity — shown as "—", not ₪0. */
  hasData: boolean;
  billed: number;
  received: number;
  adjusted: number;
  /** Point-in-time at the month's end (now, for the current month). Never summed. */
  owedAtEnd: number;
  creditAtEnd: number;
  orders: number;
  units: number;
}

export interface IncomeBread {
  breadTypeId: number;
  breadTypeName: string;
  /** null for lines written before sizes existed. */
  breadSizeId: number | null;
  sizeName: string | null;
  /** Units per month, January first — always 12 entries. */
  byMonth: number[];
  total: number;
}

export interface IncomeCustomer {
  customerId: number;
  name: string;
  isActive: boolean;
  /** Ledger balance at the start of the year (negative = owes). */
  openingBalance: number;
  billed: number;
  received: number;
  adjusted: number;
  /** Ledger balance at the year's end, or now for the current year. */
  closingBalance: number;
}

export interface IncomeTotals {
  billed: number;
  received: number;
  adjusted: number;
  orders: number;
  units: number;
  openingOwed: number;
  openingCredit: number;
  closingOwed: number;
  closingCredit: number;
}

export interface IncomeReport {
  year: number;
  /** The current year on the bakery's calendar — the picker's upper bound. */
  currentYear: number;
  /** The first year with any data — the picker's lower bound. */
  firstYear: number;
  isCurrentYear: boolean;
  /** This month (1–12) when the year is the current one, else null — the month shown as "עד היום". */
  currentMonth: number | null;
  /** Israel date (YYYY-MM-DD) of the first ledger row or delivery; null when there is none. */
  dataStart: string | null;
  /** The year contains recorded days from before AUTO_CHARGE_SINCE. */
  billedIncomplete: boolean;
  groupName: string;
  /** ISO instant the figures were read. */
  generatedAt: string;
  /** January … December for a past year; January … this month for the current one. */
  months: IncomeMonth[];
  totals: IncomeTotals;
  breads: IncomeBread[];
  customers: IncomeCustomer[];
}

/**
 * "₪1,234" for whole shekels, "₪1,234.50" otherwise. `round` drops the agorot
 * for narrow table cells; the spreadsheet keeps them. `signed` writes "+" on a
 * positive value, for a column where the sign is the meaning (a balance: minus
 * owes, plus is credit) and colour alone can't be trusted to carry it.
 */
export function formatAgorot(
  agorot: number,
  opts: { round?: boolean; signed?: boolean } = {}
): string {
  const value = opts.round ? Math.round(agorot / 100) * 100 : agorot;
  const whole = value % 100 === 0;
  const digits = (Math.abs(value) / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  const sign = value < 0 ? '-' : opts.signed && value > 0 ? '+' : '';
  return `${sign}₪${digits}`;
}

/** "26/03/2026" from "2026-03-26". */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "13/10/2026 21:40" in Israel time, from an ISO instant. */
export function formatIsraelDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
}
