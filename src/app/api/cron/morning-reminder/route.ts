import { NextResponse } from 'next/server';
import { db } from '@/db';
import { groups, orders, orderItems, customers, breadTypes } from '@/db/schema';
import { eq, and, ne, inArray } from 'drizzle-orm';
import { format } from 'date-fns';
import { sendMorningSummary } from '@/lib/notifications';

export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[cron/morning-reminder] unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = format(new Date(), 'yyyy-MM-dd');
  console.log(`[cron/morning-reminder] starting for ${today}`);

  let allGroups: { id: number }[];
  try {
    allGroups = await db.select({ id: groups.id }).from(groups);
  } catch (err) {
    console.error('[cron/morning-reminder] failed to load groups:', err);
    // Return 200 so Vercel doesn't retry storm. We'll see this in logs.
    return NextResponse.json({ ok: false, error: 'load-groups-failed' });
  }

  const stats = { total: allGroups.length, sent: 0, skipped: 0, failed: 0 };

  for (const group of allGroups) {
    try {
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

      if (todayOrders.length === 0) {
        stats.skipped++;
        continue;
      }

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
        stats.sent++;
      } else {
        stats.skipped++;
      }
    } catch (err) {
      stats.failed++;
      console.error(`[cron/morning-reminder] group ${group.id} failed:`, err);
    }
  }

  console.log('[cron/morning-reminder] done:', stats);
  return NextResponse.json({ ok: true, ...stats });
}
