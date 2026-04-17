import { withGroup, jsonResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, breadTypes, payments } from '@/db/schema';
import { eq, and, gte, lte, sql, ne, inArray, or, isNull, notInArray } from 'drizzle-orm';
import { format, addDays, startOfDay } from 'date-fns';

async function enrichOrdersWithItems(orderRows: { id: number; [key: string]: any }[]) {
  const orderIds = orderRows.map((o) => o.id);
  if (orderIds.length === 0) return orderRows.map((o) => ({ ...o, items: [], totalQuantity: 0, itemsSummary: '' }));

  const allItems = await db
    .select({
      orderId: orderItems.orderId,
      breadTypeName: breadTypes.name,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .where(inArray(orderItems.orderId, orderIds));

  const itemsMap: Record<number, typeof allItems> = {};
  for (const item of allItems) {
    if (!itemsMap[item.orderId]) itemsMap[item.orderId] = [];
    itemsMap[item.orderId].push(item);
  }

  return orderRows.map((o) => {
    const items = itemsMap[o.id] || [];
    return {
      ...o,
      items,
      totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
      itemsSummary: items.map((i) => `${i.quantity} ${i.breadTypeName}`).join(', '),
    };
  });
}

export const GET = withGroup(async (_request, _auth, groupId) => {
  const today = format(startOfDay(new Date()), 'yyyy-MM-dd');
  const weekEnd = format(addDays(new Date(), 7), 'yyyy-MM-dd');
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  // Today's orders (includes orders with no delivery date that are still active)
  const todayOrderRows = await db
    .select({
      id: orders.id,
      status: orders.status,
      paid: orders.paid,
      notes: orders.notes,
      customerName: customers.name,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(orders.groupId, groupId),
        ne(orders.status, 'cancelled'),
        or(
          eq(orders.deliveryDate, today),
          and(
            isNull(orders.deliveryDate),
            notInArray(orders.status, ['delivered', 'cancelled'])
          )
        )
      )
    );

  const todayOrders = await enrichOrdersWithItems(todayOrderRows);

  // Upcoming orders
  const upcomingOrderRows = await db
    .select({
      id: orders.id,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      customerName: customers.name,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(orders.groupId, groupId),
        gte(orders.deliveryDate, tomorrow),
        lte(orders.deliveryDate, weekEnd),
        ne(orders.status, 'cancelled')
      )
    );

  const upcomingOrders = await enrichOrdersWithItems(upcomingOrderRows);

  // Pending count
  const [pendingResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(and(eq(orders.groupId, groupId), eq(orders.status, 'pending')));

  // Customers with debt
  const customersWithDebt = await db
    .select({
      customerId: payments.customerId,
      customerName: customers.name,
      balance: sql<string>`SUM(${payments.amount})`,
    })
    .from(payments)
    .innerJoin(customers, eq(payments.customerId, customers.id))
    .where(eq(payments.groupId, groupId))
    .groupBy(payments.customerId, customers.name)
    .having(sql`SUM(${payments.amount}) < 0`);

  const totalPendingLoaves = todayOrders.reduce((s, o) => s + o.totalQuantity, 0);

  return jsonResponse({
    todayOrders,
    upcomingOrders,
    pendingCount: pendingResult.count,
    customersWithDebt,
    totalPendingLoaves,
  });
});
