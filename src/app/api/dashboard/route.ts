import { withGroup, jsonResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, customers, breadTypes, payments } from '@/db/schema';
import { eq, and, gte, lte, sql, ne } from 'drizzle-orm';
import { format, addDays, startOfDay } from 'date-fns';

export const GET = withGroup(async (_request, _auth, groupId) => {
  const today = format(startOfDay(new Date()), 'yyyy-MM-dd');
  const weekEnd = format(addDays(new Date(), 7), 'yyyy-MM-dd');

  // Today's orders
  const todayOrders = await db
    .select({
      id: orders.id,
      quantity: orders.quantity,
      status: orders.status,
      notes: orders.notes,
      customerName: customers.name,
      breadTypeName: breadTypes.name,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .innerJoin(breadTypes, eq(orders.breadTypeId, breadTypes.id))
    .where(
      and(
        eq(orders.groupId, groupId),
        eq(orders.deliveryDate, today),
        ne(orders.status, 'cancelled')
      )
    );

  // Upcoming orders (next 7 days, excluding today)
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  const upcomingOrders = await db
    .select({
      id: orders.id,
      quantity: orders.quantity,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      customerName: customers.name,
      breadTypeName: breadTypes.name,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .innerJoin(breadTypes, eq(orders.breadTypeId, breadTypes.id))
    .where(
      and(
        eq(orders.groupId, groupId),
        gte(orders.deliveryDate, tomorrow),
        lte(orders.deliveryDate, weekEnd),
        ne(orders.status, 'cancelled')
      )
    );

  // Pending count
  const [pendingResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(
      and(eq(orders.groupId, groupId), eq(orders.status, 'pending'))
    );

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

  // Total pending loaves
  const totalPendingLoaves = todayOrders.reduce(
    (sum, o) => sum + o.quantity,
    0
  );

  return jsonResponse({
    todayOrders,
    upcomingOrders,
    pendingCount: pendingResult.count,
    customersWithDebt,
    totalPendingLoaves,
  });
});
