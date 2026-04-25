/**
 * One-shot script: bootstraps the drizzle migrations tracking table
 * for a database whose schema was originally created with `drizzle-kit push`
 * (so __drizzle_migrations doesn't exist yet).
 *
 * Marks migrations 0000 and 0001 as already applied so that the next
 * `pnpm db:migrate` will only run 0002 onwards.
 *
 * Safe to re-run: ON CONFLICT DO NOTHING.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import journal from '../drizzle/meta/_journal.json';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const sql = neon(process.env.DATABASE_URL);

  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  // Mark all entries up to and including 0001 as applied (these were pushed via db:push).
  // The migrator only checks the latest `created_at`, so one row suffices,
  // but we insert one per pre-existing migration for traceability.
  const preexisting = journal.entries.filter((e) =>
    ['0000_same_squadron_supreme', '0001_certain_mathemanic'].includes(e.tag)
  );

  const existing = await sql`SELECT COUNT(*) as count FROM drizzle.__drizzle_migrations`;
  if (Number(existing[0].count) > 0) {
    console.log('Migrations table already populated, skipping bootstrap.');
    return;
  }

  for (const entry of preexisting) {
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${'bootstrap-' + entry.tag}, ${entry.when})
    `;
    console.log(`Marked ${entry.tag} as applied (created_at=${entry.when})`);
  }

  console.log('Bootstrap complete. Run `pnpm db:migrate` to apply remaining migrations.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
