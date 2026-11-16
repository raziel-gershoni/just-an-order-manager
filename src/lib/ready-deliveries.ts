import { and, eq, type SQL } from 'drizzle-orm';
import { orders } from '@/db/schema';

/** The deliveries to drive now: a delivery order of this group marked ready (מוכן). Orders still waiting or baking stay off the deliveries screen until they are ready. One definition, shared by the deliveries list and the route endpoint, so they always agree on which orders are in the run. */
export function readyDeliveriesWhere(groupId: number): SQL {
  return and(
    eq(orders.groupId, groupId),
    eq(orders.isDelivery, true),
    eq(orders.status, 'ready')
  ) as SQL;
}
