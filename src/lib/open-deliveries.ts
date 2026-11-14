import { and, eq, notInArray, type SQL } from 'drizzle-orm';
import { orders } from '@/db/schema';

/** The deliveries still to make: a delivery order of this group that is neither delivered nor cancelled. One definition, shared by the deliveries list and the route endpoint, so they always agree on which orders are open. */
export function openDeliveriesWhere(groupId: number): SQL {
  return and(
    eq(orders.groupId, groupId),
    eq(orders.isDelivery, true),
    notInArray(orders.status, ['delivered', 'cancelled'])
  ) as SQL;
}
