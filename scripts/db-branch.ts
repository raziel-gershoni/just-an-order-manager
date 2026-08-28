import { config } from 'dotenv';

// quiet, because `create --quiet` writes the connection string to stdout and
// anything else on that stream gets captured with it — a banner in the middle
// of a URL produces a "not a valid URL" that looks like an auth failure.
config({ path: '.env.local', quiet: true });

/**
 * Scratch database branches, so write paths can be tested without touching the
 * bakery's live data.
 *
 * There is no dev database — `DATABASE_URL` is production — and testing against
 * it has gone wrong twice: once destroying four customer assignments, once
 * stamping a live order. Neon branches are copy-on-write, so one is created in
 * about a second, carries a real copy of real data, and is thrown away after.
 *
 *   npx tsx scripts/db-branch.ts create   # prints the connection string
 *   npx tsx scripts/db-branch.ts list
 *   npx tsx scripts/db-branch.ts drop     # removes every scratch branch
 *
 * Then point a dev server at it. DISABLE_OUTBOUND is not optional: the branch
 * isolates rows, not Telegram or WhatsApp, and several send paths sit outside
 * the notification layer entirely.
 *   DATABASE_URL="$(npx tsx scripts/db-branch.ts create --quiet)" DISABLE_OUTBOUND=1 npx next dev
 *
 * Two guards, because this key can delete branches: nothing is ever deleted
 * unless its name carries the scratch prefix AND it is not the default branch.
 *
 * IMPORTANT: the database is branched, the outside world is not, and the
 * boundary is leakier than it looks. Even with DISABLE_OUTBOUND=1, an audit on
 * 2026-08-28 found that a local server pointed at a branch can still reach
 * outside in ways the flag does not cover:
 *   - `npm run build` runs scripts/provision-schedules.ts, which upserts the
 *     LIVE QStash cron registry using the local CRON_SECRET. Never build here.
 *   - Vercel Blob deletes are permanent and blobs are not branchable, so
 *     removing a photo from branch data destroys the real one. Inert only
 *     because BLOB_READ_WRITE_TOKEN is absent locally.
 *   - `delivered` is not database-only: createNextRecurringOrder notifies.
 *
 * Before assuming any path is silent, grep it for `notify` and `getBot`.
 */

const API = 'https://console.neon.tech/api/v2';
const KEY = process.env.NEON_API_KEY;
const PROJECT = process.env.NEON_PROJECT_ID;

/** Every branch this script creates is named with it; nothing else is touchable. */
const PREFIX = 'scratch-';

interface Branch {
  id: string;
  name: string;
  default?: boolean;
  created_at?: string;
}

async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function branches(): Promise<Branch[]> {
  const { branches } = await api<{ branches: Branch[] }>(`/projects/${PROJECT}/branches`);
  return branches;
}

async function create(quiet: boolean) {
  const all = await branches();
  const parent = all.find((b) => b.default);
  if (!parent) throw new Error('No default branch to copy from');

  const name = `${PREFIX}${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  const made = await api<{ branch: Branch; connection_uris?: { connection_uri: string }[] }>(
    `/projects/${PROJECT}/branches`,
    {
      method: 'POST',
      body: JSON.stringify({
        branch: { name, parent_id: parent.id },
        endpoints: [{ type: 'read_write' }],
      }),
    }
  );

  const uri = made.connection_uris?.[0]?.connection_uri;
  if (!uri) throw new Error('Branch created but Neon returned no connection string');

  if (quiet) {
    process.stdout.write(uri);
    return;
  }
  console.log(`branch  ${made.branch.name}  (${made.branch.id})`);
  console.log(`copied from  ${parent.name}`);
  console.log(`\n${uri}\n`);
  console.log('Drop it when you are done:  npx tsx scripts/db-branch.ts drop');
}

async function list() {
  const all = await branches();
  console.table(
    all.map((b) => ({
      name: b.name,
      default: !!b.default,
      scratch: b.name.startsWith(PREFIX),
      created: b.created_at?.slice(0, 16) ?? '',
    }))
  );
}

async function drop() {
  const all = await branches();
  // Both conditions, every time. A scratch branch that somehow became the
  // default is not one this script gets to delete.
  const removable = all.filter((b) => b.name.startsWith(PREFIX) && !b.default);
  const skipped = all.filter((b) => !removable.includes(b));

  if (removable.length === 0) {
    console.log('Nothing to drop.');
  }
  for (const b of removable) {
    await api(`/projects/${PROJECT}/branches/${b.id}`, { method: 'DELETE' });
    console.log(`dropped  ${b.name}`);
  }
  for (const b of skipped) {
    console.log(`kept     ${b.name}${b.default ? '  (default)' : '  (not a scratch branch)'}`);
  }
}

async function main() {
  if (!KEY) throw new Error('NEON_API_KEY is not set in .env.local');
  if (!PROJECT) throw new Error('NEON_PROJECT_ID is not set in .env.local');

  const command = process.argv[2];
  const quiet = process.argv.includes('--quiet');

  if (command === 'create') return create(quiet);
  if (command === 'list') return list();
  if (command === 'drop') return drop();

  console.log('Usage: npx tsx scripts/db-branch.ts <create|list|drop> [--quiet]');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
