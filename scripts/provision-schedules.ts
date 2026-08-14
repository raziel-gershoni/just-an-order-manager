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
 * Reconciliation is deliberately conservative, because this QStash account is
 * shared with other projects:
 *   - A schedule carrying our own id is upserted (QStash overwrites on a
 *     repeated `Upstash-Schedule-Id`), so edits here take effect on deploy.
 *   - A schedule already pointing at one of our cron paths is LEFT ALONE and
 *     reported. Creating ours beside it would double every message that cron
 *     sends; adopting it silently would move its time under the owner.
 *   - Anything missing is created.
 *   - Nothing is ever deleted.
 *
 * Never fails the build. A deploy that can't reach QStash should still ship;
 * the next one reconciles. Invoked from `package.json` → build.
 */

/**
 * QStash is regional and `qstash.upstash.io` is the EU endpoint, not a global
 * router — a token from another region answers it with 404 "user not found in
 * this region". `QSTASH_URL` wins when set; otherwise we find the endpoint that
 * recognises the token, so nobody has to know or configure their region.
 */
const QSTASH_HOSTS = [
  'https://qstash.upstash.io',
  'https://qstash-us-east-1.upstash.io',
  'https://qstash-eu-central-1.upstash.io',
];

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

/**
 * Match on the path, not the whole URL. The same route is reachable at the
 * canonical domain and at the *.vercel.app one, and the existing schedules use
 * the latter — comparing full URLs would read them as unrelated and schedule a
 * second copy of the morning digest.
 */
function destinationPath(destination: string): string | null {
  try {
    return new URL(destination).pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

async function findAccount(
  token: string
): Promise<{ base: string; schedules: RemoteSchedule[] } | null> {
  const configured = process.env.QSTASH_URL?.trim().replace(/\/+$/, '');
  for (const base of configured ? [configured] : QSTASH_HOSTS) {
    const res = await fetch(`${base}/v2/schedules`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { base, schedules: (await res.json()) as RemoteSchedule[] };
    if (res.status !== 404) {
      throw new Error(`list failed at ${base}: ${res.status} ${await res.text()}`);
    }
  }
  return null;
}

async function upsert(
  base: string,
  token: string,
  cronSecret: string,
  id: string,
  destination: string,
  cron: string
): Promise<void> {
  const res = await fetch(`${base}/v2/schedules/${destination}`, {
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

  const appBase = siteBaseUrl();
  // A schedule points at a public URL forever after. Refuse to write one from a
  // machine whose app URL is local, or the next run from a dev box would
  // repoint production crons at a host QStash can't reach.
  if (!/^https:\/\//i.test(appBase) || /localhost|127\.0\.0\.1/i.test(appBase)) {
    console.log(`[schedules] app URL "${appBase}" is not a public https origin — skipping.`);
    return;
  }

  const account = await findAccount(token);
  if (!account) {
    console.log('[schedules] no QStash endpoint recognised this token — skipping.');
    return;
  }
  console.log(`[schedules] using ${account.base}`);

  for (const s of SCHEDULES) {
    const destination = `${appBase}${s.path}`;
    const ours = account.schedules.find((r) => r.scheduleId === s.id);
    const foreign = account.schedules.find(
      (r) => r.scheduleId !== s.id && destinationPath(r.destination) === s.path
    );

    if (!ours && foreign) {
      console.log(
        `[schedules] ${s.path} already scheduled as ${foreign.scheduleId} ("${foreign.cron}" → ${foreign.destination}) — left alone. ` +
          `Delete it in the Upstash console to let this script manage it as "${s.id}" (${s.cron}).`
      );
      continue;
    }

    await upsert(account.base, token, cronSecret, s.id, destination, s.cron);
    console.log(
      `[schedules] ${ours ? 'updated' : 'created'} ${s.id} — ${s.cron} → ${destination} (${s.what})`
    );
  }
}

main().catch((err) => {
  // Loud, but never fatal: a deploy shouldn't fail because QStash blipped.
  console.error('[schedules] provisioning failed (deploy continues):', err);
});
