import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { orders } from '@/db/schema';
import { todayCondition } from '@/lib/asap';

/** The deliveries to drive now: a delivery order of this group marked ready (מוכן). Orders still waiting or baking stay off the deliveries screen until they are ready. One definition, shared by the deliveries list and the route endpoint, so they always agree on which orders are in the run. */
export function readyDeliveriesWhere(groupId: number): SQL {
  return and(
    eq(orders.groupId, groupId),
    eq(orders.isDelivery, true),
    eq(orders.status, 'ready')
  ) as SQL;
}

/**
 * Today's deliveries that nobody has marked ready yet (waiting, approved or
 * baking), shown under the run so whoever drives can mark them on the spot.
 * "Today" follows the bakery's בהקדם switch, like every other by-day view.
 */
export function notReadyTodayWhere(groupId: number, today: string, asapInToday: boolean): SQL {
  return and(
    eq(orders.groupId, groupId),
    eq(orders.isDelivery, true),
    inArray(orders.status, ['pending', 'confirmed', 'baking']),
    todayCondition(today, asapInToday)
  ) as SQL;
}
