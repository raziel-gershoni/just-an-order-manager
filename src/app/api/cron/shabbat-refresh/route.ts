import { NextResponse } from 'next/server';
import { isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { groups } from '@/db/schema';
import { todayStr } from '@/lib/date-utils';
import { notifyShabbatTimesStale } from '@/lib/notifications';
import { refreshShabbatTimes, shabbatCoverageGap } from '@/lib/shabbat-times';

export const maxDuration = 60;

// The kitchen screen's Shabbat times (src/lib/shabbat-times.ts), fetched again
// from famcal every morning for each bakery with the mode on. A failure keeps
// the stored times; the owner hears only once what is stored reaches less than
// eight days ahead. It is its own cron, not part of the morning reminder: famcal
// is an outside service, and a slow answer there must never time out the
// morning messages and have QStash send them all a second time.
async function handler(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[cron/shabbat-refresh] unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = todayStr();
  let bakeries: { id: number }[];
  try {
    bakeries = await db.select({ id: groups.id }).from(groups).where(isNotNull(groups.shabbatCity)).orderBy(groups.id);
  } catch (err) {
    console.error('[cron/shabbat-refresh] failed to load the bakeries:', err);
    // 200 so QStash doesn't retry-storm; the log says what happened.
    return NextResponse.json({ ok: false, error: 'load-groups-failed' });
  }

  const stats = { total: bakeries.length, refreshed: 0, changed: 0, failed: 0, warned: 0, notified: 0, notifyFailed: 0, checkFailed: 0 };
  for (const { id } of bakeries) {
    try {
      const result = await refreshShabbatTimes(id, today);
      if (result === 'refreshed') stats.refreshed++;
      if (result === 'changed') stats.changed++;
      if (result === 'failed') stats.failed++;
      if (result === 'off') continue;
      const gap = await shabbatCoverageGap(id, today);
      if (gap) {
        const sent = await notifyShabbatTimesStale(id, gap.through);
        stats.warned++;
        stats.notified += sent.sent;
        stats.notifyFailed += sent.failed;
      }
    } catch (err) {
      stats.checkFailed++;
      console.error(`[cron/shabbat-refresh] group ${id} failed:`, err);
    }
  }

  console.log(`[cron/shabbat-refresh] done for ${today}:`, stats);
  return NextResponse.json({ ok: true, ...stats });
}

// POST only, like the other crons: QStash calls with POST (scripts/provision-schedules.ts).
export const POST = handler;
