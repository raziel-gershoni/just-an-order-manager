import { NextResponse } from 'next/server';
import { db } from '@/db';
import { groups, orders, orderItems, customers, breadTypes } from '@/db/schema';
import { eq, and, ne, inArray } from 'drizzle-orm';
import { format } from 'date-fns';
import { sendMorningSummary } from '@/lib/notifications';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = format(new Date(), 'yyyy-MM-dd');

  const allGroups = await db.select({ id: groups.id }).from(groups);

  for (const group of allGroups) {
    const todayOrders = await db
      .select({
        id: orders.id,
        customerName: customers.name,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(
        and(
          eq(orders.groupId, group.id),
          eq(orders.deliveryDate, today),
          ne(orders.status, 'cancelled'),
          ne(orders.status, 'delivered')
        )
      );

    if (todayOrders.length === 0) continue;

    const orderIds = todayOrders.map((o) => o.id);
    const allItems = await db
      .select({
        orderId: orderItems.orderId,
        breadTypeName: breadTypes.name,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
      .where(inArray(orderItems.orderId, orderIds));

    // Flatten into per-customer items for the summary
    const summaryItems: { customerName: string; breadTypeName: string; quantity: number }[] = [];
    for (const order of todayOrders) {
      const items = allItems.filter((i) => i.orderId === order.id);
      for (const item of items) {
        summaryItems.push({
          customerName: order.customerName,
          breadTypeName: item.breadTypeName,
          quantity: item.quantity,
        });
      }
    }

    if (summaryItems.length > 0) {
      await sendMorningSummary(group.id, summaryItems);
    }
  }

  return NextResponse.json({ success: true });
}
