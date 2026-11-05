import { and, eq, gte, isNull, lt, notInArray, or, type SQL } from 'drizzle-orm';
import { orders } from '@/db/schema';

/**
 * The two "an order is waiting on a person" rules. The morning Telegram nudges
 * (src/lib/order-nudges.ts) list these orders and the kitchen screen
 * (src/lib/kitchen-sheet.ts) counts them, both through here, so the chat and
 * the screen can't disagree. They never overlap: an order nobody approved
 * whose day has passed is overdue, not awaiting approval.
 */

/** Dated before today and neither delivered nor cancelled. בהקדם orders have no date, so they never are. */
export function overdue(today: string): SQL {
  return and(lt(orders.deliveryDate, today), notInArray(orders.status, ['delivered', 'cancelled']))!;
}

/**
 * Still `pending` (nobody tapped אשר) with the delivery ahead. בהקדם orders
 * carry no date and "as soon as possible" is always still ahead, so they
 * count; a plain `deliveryDate >= today` would drop them with the NULLs.
 */
export function awaitingApproval(today: string): SQL {
  return and(eq(orders.status, 'pending'), or(isNull(orders.deliveryDate), gte(orders.deliveryDate, today)))!;
}
