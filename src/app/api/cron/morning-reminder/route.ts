import { NextResponse } from 'next/server';
import { db } from '@/db';
import { groups, orders, orderItems, customers, breadTypes, breadSizes, breadAdditions, orderItemAdditions } from '@/db/schema';
import { eq, and, asc, ne, inArray } from 'drizzle-orm';
import { todayStr } from '@/lib/date-utils';
import { sendMorningSummary } from '@/lib/notifications';
import { formatStaffItemLabel } from '@/lib/order-display';
import { buildRecipeBlockForOrders } from '@/lib/order-recipe';
import { sendPendingApprovalNudge, sendUnpaidNudge } from '@/lib/order-nudges';

export const maxDuration = 60;

interface Stats {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Telegram deliveries across every message this cron sends. */
  notified: number;
  notifyFailed: number;
  approvalNudges: number;
  unpaidNudges: number;
  nudgeFailed: number;
}

async function handler(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[cron/morning-reminder] unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = todayStr();
  console.log(`[cron/morning-reminder] starting for ${today}`);

  let allGroups: { id: number }[];
  try {
    allGroups = await db.select({ id: groups.id }).from(groups);
  } catch (err) {
    console.error('[cron/morning-reminder] failed to load groups:', err);
    // Return 200 so Vercel doesn't retry storm. We'll see this in logs.
    return NextResponse.json({ ok: false, error: 'load-groups-failed' });
  }

  const stats: Stats = {
    total: allGroups.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    notified: 0,
    notifyFailed: 0,
    approvalNudges: 0,
    unpaidNudges: 0,
    nudgeFailed: 0,
  };

  for (const group of allGroups) {
    await sendBakingSummary(group.id, today, stats);

    // The nudges are deliberately independent of the baking summary — a group
    // with nothing in the oven today can still have orders nobody approved or
    // settled — and independent of each other, so one bad query can't mute the
    // rest of the morning.
    try {
      const result = await sendPendingApprovalNudge(group.id);
      if (result) {
        stats.approvalNudges++;
        stats.notified += result.sent;
        stats.notifyFailed += result.failed;
      }
    } catch (err) {
      stats.nudgeFailed++;
      console.error(`[cron/morning-reminder] approval nudge failed for group ${group.id}:`, err);
    }

    try {
      const result = await sendUnpaidNudge(group.id);
      if (result) {
        stats.unpaidNudges++;
        stats.notified += result.sent;
        stats.notifyFailed += result.failed;
      }
    } catch (err) {
      stats.nudgeFailed++;
      console.error(`[cron/morning-reminder] unpaid nudge failed for group ${group.id}:`, err);
    }
  }

  console.log('[cron/morning-reminder] done:', stats);
  return NextResponse.json({ ok: true, ...stats });
}

/** Today's bake, grouped by bread type, with the per-type recipe block. */
async function sendBakingSummary(groupId: number, today: string, stats: Stats) {
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
          eq(orders.groupId, groupId),
          eq(orders.deliveryDate, today),
          ne(orders.status, 'cancelled'),
          ne(orders.status, 'delivered')
        )
      );

    if (todayOrders.length === 0) {
      stats.skipped++;
      return;
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
      console.error(`[cron/morning-reminder] recipe block failed for group ${groupId}:`, err);
    }

    if (summaryItems.length > 0) {
      const { sent: okCount, failed: failCount } = await sendMorningSummary(
        groupId,
        summaryItems,
        recipeBlock
      );
      stats.sent++;
      stats.notified += okCount;
      stats.notifyFailed += failCount;
      // sendToRecipients already logs each failed send; surface the group tally too.
      if (failCount > 0) {
        console.warn(
          `[cron/morning-reminder] group ${groupId}: ${failCount} baker notification(s) failed to deliver`
        );
      }
    } else {
      stats.skipped++;
    }
  } catch (err) {
    stats.failed++;
    console.error(`[cron/morning-reminder] group ${groupId} failed:`, err);
  }
}

export const GET = handler;
export const POST = handler;
