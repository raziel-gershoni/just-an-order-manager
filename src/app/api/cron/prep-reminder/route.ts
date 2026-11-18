import { NextResponse } from 'next/server';
import { db } from '@/db';
import { groups } from '@/db/schema';
import { addDaysStr, israelHour, todayStr, weekdayIndex } from '@/lib/date-utils';
import { sendPrepReminder } from '@/lib/notifications';
import { prepBake } from '@/lib/day-digest';
import { prepSlotSends } from '@/lib/prep-reminder';

export const maxDuration = 60;

/**
 * Day-before prep reminder for bakers. QStash fires it at 06:00 and 20:00
 * Israel time daily; prepSlotSends keeps 06:00 Sun-Fri and 20:00 Sat. It always
 * answers 200 with its stats so QStash never resends, and one group's failure
 * never stops the others.
 */
async function handler(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[cron/prep-reminder] unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = todayStr();
  const hour = israelHour();
  if (!prepSlotSends(weekdayIndex(today), hour)) {
    console.log(`[cron/prep-reminder] not a sending slot (${today}, hour ${hour}); nothing to do`);
    return NextResponse.json({ ok: true, slot: false });
  }

  const tomorrow = addDaysStr(today, 1);
  console.log(`[cron/prep-reminder] starting for ${tomorrow}`);

  let allGroups: { id: number }[];
  try {
    allGroups = await db.select({ id: groups.id }).from(groups);
  } catch (err) {
    console.error('[cron/prep-reminder] failed to load groups:', err);
    return NextResponse.json({ ok: false, error: 'load-groups-failed' });
  }

  const stats = { total: allGroups.length, sent: 0, skipped: 0, failed: 0, notified: 0, notifyFailed: 0 };
  for (const group of allGroups) {
    try {
      const bake = await prepBake(group.id, tomorrow);
      if (!bake) {
        stats.skipped++;
        continue;
      }
      const { sent, failed } = await sendPrepReminder(group.id, tomorrow, bake);
      stats.sent++;
      stats.notified += sent;
      stats.notifyFailed += failed;
      console.log(`[cron/prep-reminder] group ${group.id}: sent ${sent}, failed ${failed}`);
    } catch (err) {
      stats.failed++;
      console.error(`[cron/prep-reminder] group ${group.id} failed:`, err);
    }
  }

  console.log('[cron/prep-reminder] done:', stats);
  return NextResponse.json({ ok: true, slot: true, ...stats });
}

// POST only, like the other crons: QStash calls with POST.
export const POST = handler;
