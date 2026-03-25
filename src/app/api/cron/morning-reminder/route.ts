import { NextResponse } from 'next/server';
import { db } from '@/db';
import { groups, orders, customers, breadTypes } from '@/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { format } from 'date-fns';
import { sendMorningSummary } from '@/lib/notifications';

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = format(new Date(), 'yyyy-MM-dd');

  // Get all groups
  const allGroups = await db.select({ id: groups.id }).from(groups);

  for (const group of allGroups) {
    const todayOrders = await db
      .select({
        customerName: customers.name,
        breadTypeName: breadTypes.name,
        quantity: orders.quantity,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .innerJoin(breadTypes, eq(orders.breadTypeId, breadTypes.id))
      .where(
        and(
          eq(orders.groupId, group.id),
          eq(orders.deliveryDate, today),
          ne(orders.status, 'cancelled'),
          ne(orders.status, 'delivered')
        )
      );

    if (todayOrders.length > 0) {
      await sendMorningSummary(group.id, todayOrders);
    }
  }

  return NextResponse.json({ success: true });
}
