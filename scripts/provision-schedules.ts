import { config } from 'dotenv';
config({ path: '.env.local' });

import { siteBaseUrl } from '../src/lib/site-url';

/**
 * Declare the app's QStash schedules in code and reconcile them on every deploy,
 * the way `migrate.ts` does for the database.
 *
 * This exists because a cron that was never scheduled is invisible: the
 * recurring-order reminder shipped with its toggle on and its template
 * registered, then sat dead for three weeks because the one manual step — a
 * schedule in the Upstash console — was missed, and nothing anywhere said so.
 *
 * Reconciliation is deliberately conservative:
 *   - A schedule carrying our own id is upserted (QStash overwrites on a
 *     repeated `Upstash-Schedule-Id`), so edits here take effect on deploy.
 *   - A schedule someone created by hand for the same destination is LEFT
 *     ALONE and reported. Creating ours next to it would double every message
 *     that cron sends; adopting it silently would move its time under the
 *     owner. Deleting the console copy once hands it over to this script.
 *   - Anything missing is created.
 *
 * Never fails the build. A deploy that can't reach QStash should still ship;
 * the next one reconciles. Invoked from `package.json` → build.
 */

const QSTASH_API = 'https://qstash.upstash.io/v2/schedules';

/** Times are Asia/Jerusalem via the CRON_TZ prefix — a bare UTC expression
 *  would drift an hour twice a year against Israeli DST. */
const SCHEDULES = [
  {
    id: 'razei-morning-reminder',
    path: '/api/cron/morning-reminder',
    cron: 'CRON_TZ=Asia/Jerusalem 0 6 * * *',
    what: 'baking summary + approval/unpaid nudges',
  },
  {
    id: 'razei-recurring-reminder',
    path: '/api/cron/recurring-reminder',
    cron: 'CRON_TZ=Asia/Jerusalem 0 10 * * *',
    what: 'recurring-order reminders (no-ops except Sun/Wed)',
  },
  {
    id: 'razei-weekly-summary',
    path: '/api/cron/weekly-summary',
    cron: 'CRON_TZ=Asia/Jerusalem 0 21 * * 6',
    what: 'weekly summary',
  },
] as const;

type RemoteSchedule = { scheduleId: string; destination: string; cron: string };

/** Compare destinations without tripping over a trailing slash. */
function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => u.replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

async function listSchedules(token: string): Promise<RemoteSchedule[]> {
  const res = await fetch(QSTASH_API, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`list failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as RemoteSchedule[];
}

async function upsert(
  token: string,
  cronSecret: string,
  id: string,
  destination: string,
  cron: string
): Promise<void> {
  const res = await fetch(`${QSTASH_API}/${destination}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Upstash-Schedule-Id': id,
      'Upstash-Cron': cron,
      'Upstash-Method': 'POST',
      // The route authenticates on this header; QStash forwards anything
      // prefixed with Upstash-Forward- to the destination.
      'Upstash-Forward-Authorization': `Bearer ${cronSecret}`,
    },
  });
  if (!res.ok) throw new Error(`upsert ${id} failed: ${res.status} ${await res.text()}`);
}

async function main() {
  const token = process.env.QSTASH_TOKEN;
  const cronSecret = process.env.CRON_SECRET;
  if (!token || !cronSecret) {
    console.log(
      '[schedules] QSTASH_TOKEN or CRON_SECRET not set — skipping. Schedules stay as they are in the Upstash console.'
    );
    return;
  }

  const base = siteBaseUrl();
  const remote = await listSchedules(token);

  for (const s of SCHEDULES) {
    const destination = `${base}${s.path}`;
    const ours = remote.find((r) => r.scheduleId === s.id);
    const foreign = remote.find(
      (r) => r.scheduleId !== s.id && sameUrl(r.destination, destination)
    );

    if (!ours && foreign) {
      console.log(
        `[schedules] ${s.path} already scheduled by hand (${foreign.scheduleId}, "${foreign.cron}") — left alone. ` +
          `Delete it in the Upstash console to let this script manage it as "${s.id}" (${s.cron}).`
      );
      continue;
    }

    await upsert(token, cronSecret, s.id, destination, s.cron);
    console.log(`[schedules] ${ours ? 'updated' : 'created'} ${s.id} — ${s.cron} → ${s.path} (${s.what})`);
  }
}

main().catch((err) => {
  // Loud, but never fatal: a deploy shouldn't fail because QStash blipped.
  console.error('[schedules] provisioning failed (deploy continues):', err);
});
