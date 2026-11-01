import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * The bakery's calendar day (Asia/Jerusalem) of a `timestamp` column that holds
 * UTC wall-clock, as a `date`. Our timestamps have no zone, so `col::date` is
 * the UTC day — a different day for the first two or three hours of every
 * Israeli one — and a single `AT TIME ZONE 'Asia/Jerusalem'` goes the wrong way
 * (it reads the UTC wall-clock as if it were Israeli). The inner `AT TIME ZONE
 * 'UTC'` says what the stored value is, the outer one converts it.
 *
 * Use it wherever a stored instant stands in for a delivery date, such as
 * `coalesce(delivery_date, <this>)`. For "today" and for string dates, use the
 * helpers in `@/lib/date-utils`.
 */
export function israelDay(utcTimestamp: AnyColumn | SQL): SQL<string> {
  return sql<string>`((${utcTimestamp} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem')::date`;
}
