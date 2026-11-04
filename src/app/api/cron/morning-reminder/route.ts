import { NextResponse } from 'next/server';
import { db } from '@/db';
import { groups } from '@/db/schema';
import { todayStr } from '@/lib/date-utils';
import { sendMorningSummary, notifyRemindersStalled } from '@/lib/notifications';
import { findMissedRecurringReminders } from '@/lib/reminder-health';
import { morningBake } from '@/lib/day-digest';
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
  /** Groups warned that the recurring reminder has stopped running. */
  stalledWarnings: number;
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
    stalledWarnings: 0,
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

    // The one cron that reports on another cron. The recurring reminder can
    // only stay silent when it works, so nothing but this would ever say it
    // had stopped — it went three weeks unscheduled before anyone noticed.
    try {
      const { missed, cause } = await findMissedRecurringReminders(group.id);
      if (missed.length > 0) {
        const result = await notifyRemindersStalled(group.id, missed, cause);
        stats.stalledWarnings++;
        stats.notified += result.sent;
        stats.notifyFailed += result.failed;
      }
    } catch (err) {
      stats.nudgeFailed++;
      console.error(`[cron/morning-reminder] reminder health check failed for group ${group.id}:`, err);
    }
  }

  console.log('[cron/morning-reminder] done:', stats);
  return NextResponse.json({ ok: true, ...stats });
}

/** Today's bake, grouped by bread type, with the per-type recipe block. */
async function sendBakingSummary(groupId: number, today: string, stats: Stats) {
  try {
    const bake = await morningBake(groupId, today);
    if (!bake) {
      stats.skipped++;
      return;
    }

    const { sent: okCount, failed: failCount } = await sendMorningSummary(groupId, bake);
    stats.sent++;
    stats.notified += okCount;
    stats.notifyFailed += failCount;
    // sendToRecipients already logs each failed send; surface the group tally too.
    if (failCount > 0) {
      console.warn(
        `[cron/morning-reminder] group ${groupId}: ${failCount} baker notification(s) failed to deliver`
      );
    }
  } catch (err) {
    stats.failed++;
    console.error(`[cron/morning-reminder] group ${groupId} failed:`, err);
  }
}

// POST only. QStash calls these with POST (Upstash-Method: POST in
// scripts/provision-schedules.ts) and there are no Vercel crons — vercel.json
// is empty — so nothing needs GET. Exporting it meant the secret in a URL bar
// was enough to fire the job from a browser tab; the weekly summary messages
// every member of every group.
export const POST = handler;
