import { NextResponse } from 'next/server';
import { db } from '@/db';
import { groups, orders, orderItems, customers, breadTypes, breadSizes, breadAdditions, orderItemAdditions } from '@/db/schema';
import { eq, and, asc, ne, inArray } from 'drizzle-orm';
import { format } from 'date-fns';
import { sendMorningSummary } from '@/lib/notifications';
import { formatStaffItemLabel } from '@/lib/order-display';
import { buildRecipeBlockForOrders } from '@/lib/order-recipe';

export const maxDuration = 60;

async function handler(request: Request) {
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

  const stats = { total: allGroups.length, sent: 0, skipped: 0, failed: 0, notified: 0, notifyFailed: 0 };

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
          id: orderItems.id,
          orderId: orderItems.orderId,
          breadTypeId: orderItems.breadTypeId,
          breadTypeName: breadTypes.name,
          sizeName: breadSizes.name,
          weightGrams: breadSizes.weightGrams,
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

      const summaryItems: { customerName: string; breadTypeName: string; quantity: number }[] = [];
      for (const order of todayOrders) {
        const items = allItems.filter((i) => i.orderId === order.id);
        for (const item of items) {
          summaryItems.push({
            customerName: order.customerName,
            breadTypeName: formatStaffItemLabel(item.breadTypeName, item.sizeName, item.weightGrams, additionsByItem[item.id] ?? []),
            quantity: item.quantity,
          });
        }
      }

      // Build per-type recipe block for the baker (Hebrew)
      let recipeBlock: string | undefined;
      try {
        recipeBlock = (await buildRecipeBlockForOrders(todayOrders.map((o) => o.id))) || undefined;
      } catch (err) {
        console.error(`[cron/morning-reminder] recipe block failed for group ${group.id}:`, err);
      }

      if (summaryItems.length > 0) {
        const { sent: okCount, failed: failCount } = await sendMorningSummary(
          group.id,
          summaryItems,
          recipeBlock
        );
        stats.sent++;
        stats.notified += okCount;
        stats.notifyFailed += failCount;
        // sendToRecipients already logs each failed send; surface the group tally too.
        if (failCount > 0) {
          console.warn(
            `[cron/morning-reminder] group ${group.id}: ${failCount} baker notification(s) failed to deliver`
          );
        }
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

export const GET = handler;
export const POST = handler;
