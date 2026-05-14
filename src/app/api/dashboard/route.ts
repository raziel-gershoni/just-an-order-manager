import { withGroup, jsonResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, breadTypes, breadSizes, breadAdditions, orderItemAdditions, payments } from '@/db/schema';
import { eq, and, asc, gte, lte, sql, ne, inArray, or, isNull, notInArray } from 'drizzle-orm';
import { format, addDays, startOfDay } from 'date-fns';
import { formatItemLine } from '@/lib/order-display';

async function enrichOrdersWithItems(orderRows: { id: number; [key: string]: any }[]) {
  const orderIds = orderRows.map((o) => o.id);
  if (orderIds.length === 0) return orderRows.map((o) => ({ ...o, items: [], totalQuantity: 0, itemsSummary: '' }));

  const allItems = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      breadTypeName: breadTypes.name,
      sizeName: breadSizes.name,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
    .where(inArray(orderItems.orderId, orderIds));

  const itemIds = allItems.map((i) => i.id);
  const additionLinks = itemIds.length
    ? await db
        .select({ orderItemId: orderItemAdditions.orderItemId, name: breadAdditions.name })
        .from(orderItemAdditions)
        .innerJoin(breadAdditions, eq(orderItemAdditions.breadAdditionId, breadAdditions.id))
        .where(inArray(orderItemAdditions.orderItemId, itemIds))
        .orderBy(asc(breadAdditions.sortOrder))
    : [];
  const additionsByItem: Record<number, string[]> = {};
  for (const a of additionLinks) {
    if (!additionsByItem[a.orderItemId]) additionsByItem[a.orderItemId] = [];
    additionsByItem[a.orderItemId].push(a.name);
  }

  type ItemWithAdditions = typeof allItems[number] & { additions: string[] };
  const itemsMap: Record<number, ItemWithAdditions[]> = {};
  for (const item of allItems) {
    if (!itemsMap[item.orderId]) itemsMap[item.orderId] = [];
    itemsMap[item.orderId].push({ ...item, additions: additionsByItem[item.id] ?? [] });
  }

  return orderRows.map((o) => {
    const items = itemsMap[o.id] || [];
    return {
      ...o,
      items,
      totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
      itemsSummary: items.map((i) => formatItemLine(i.quantity, i.breadTypeName, i.sizeName, i.additions)).join(', '),
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
      isRecurring: orders.isRecurring,
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
      isRecurring: orders.isRecurring,
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
