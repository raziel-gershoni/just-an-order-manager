/**
 * How overdue a customer is — against their own rhythm, not the calendar.
 *
 * Pure: no DB, no React. The bakery runs on Fridays (49 of 65 live orders
 * deliver on one, and a third of all gaps between orders are exactly 7 days),
 * but the rhythms themselves span 6.6× — one household orders weekly, another
 * every six weeks. So a fixed "hasn't ordered in 30 days" line is meaningless
 * here. The case that settles it: two customers last ordered on the same day,
 * 69 days ago. One had built a weekly habit over seven orders and stopped
 * dead; the other ordered once and never came back. Absolute days call them
 * identical. They are not the same problem and they do not want the same call.
 *
 * Backtested over 14 weekly cutoffs: this flags more customers than a 28-day
 * absolute rule at less than half the false-alarm rate.
 */

/** What the database can tell us about one customer's ordering history. */
export interface OrderRhythm {
  /** Non-cancelled orders already delivered. */
  pastOrders: number;
  /** Most recent past delivery date, `YYYY-MM-DD`. Null when they have none yet. */
  lastOrder: string | null;
  /** Earliest future delivery date, if one is already on the calendar. */
  nextOrder: string | null;
  /** Median days between consecutive orders. Null below two gaps. */
  medianGap: number | null;
}

export type TemperatureBand = 'booked' | 'fresh' | 'easing' | 'slipping' | 'late' | 'cold';

export interface Temperature {
  band: TemperatureBand;
  /** The last delivered order's date, so callers can render it without a second query. */
  lastOrder: string | null;
  /** Days since the last delivered order. Null when there has never been one. */
  daysSince: number | null;
  /** How many times their own gap has elapsed. Null when nothing is scoreable. */
  ratio: number | null;
  /** True when the score rests on their own measured rhythm rather than the default. */
  fromOwnRhythm: boolean;
}

/**
 * A customer with under three orders has no rhythm, and inventing one from a
 * single gap is noise dressed as a metric — one household's lone 5-day gap
 * would read as "2.2× overdue" eleven days later. They are scored against a
 * deliberately generous six-week default instead.
 */
const DEFAULT_GAP_DAYS = 45;

/**
 * Clamped because a median built on two observations is not a rhythm yet: one
 * customer's two gaps average 46 days, which would otherwise license a
 * seven-week silence as "on time". The floor stops a tight rhythm from
 * screaming after four days.
 */
const MIN_GAP_DAYS = 5;
const MAX_GAP_DAYS = 45;

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/** `todayISO` is passed in rather than read from the clock, so this stays pure. */
export function temperatureOf(rhythm: OrderRhythm, todayISO: string): Temperature {
  // An order already on the calendar settles it: they are not going cold, they
  // are coming in on Friday. This flips a quarter of the list, and for a brand
  // new customer whose first order has not arrived yet it is the difference
  // between "arriving tomorrow" and "no data at all".
  if (rhythm.nextOrder && rhythm.nextOrder > todayISO) {
    return { band: 'booked', lastOrder: rhythm.lastOrder, daysSince: null, ratio: null, fromOwnRhythm: false };
  }

  if (!rhythm.lastOrder) {
    return { band: 'fresh', lastOrder: null, daysSince: null, ratio: null, fromOwnRhythm: false };
  }

  const daysSince = Math.max(0, daysBetween(rhythm.lastOrder, todayISO));
  const fromOwnRhythm = rhythm.pastOrders >= 3 && rhythm.medianGap != null;
  const expected = fromOwnRhythm
    ? Math.min(MAX_GAP_DAYS, Math.max(MIN_GAP_DAYS, rhythm.medianGap!))
    : DEFAULT_GAP_DAYS;

  const ratio = daysSince / expected;
  return { band: bandFor(ratio), lastOrder: rhythm.lastOrder, daysSince, ratio, fromOwnRhythm };
}

function bandFor(ratio: number): TemperatureBand {
  if (ratio <= 0.5) return 'fresh';
  if (ratio <= 1) return 'easing';
  if (ratio <= 2) return 'slipping';
  if (ratio <= 3.5) return 'late';
  return 'cold';
}

/**
 * Sort key for the temperature view: most overdue first.
 *
 * Booked customers sink to the bottom — they are the one group with nothing to
 * decide about. Everything else falls in by ratio, which is what keeps a
 * lapsed regular above a lead that never converted even when the two last
 * ordered on the very same day.
 */
export function temperatureRank(t: Temperature): number {
  if (t.band === 'booked') return -1;
  return t.ratio ?? 0;
}
