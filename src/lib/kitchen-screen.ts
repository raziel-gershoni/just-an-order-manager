import { createHash, randomBytes } from 'node:crypto';
import { unstable_cache } from 'next/cache';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { groups } from '@/db/schema';
import { signExportToken, verifyExportToken } from './export-token';
import { DATA_TAG } from './cache-tags';

/**
 * The kitchen screen's access: a phone trades a one-time pairing code for a
 * long-lived signed cookie that opens /kitchen and its state check, nothing
 * else. The cookie is signed for the group's current key version, so bumping
 * the version disconnects every paired screen at once.
 */

export const KITCHEN_COOKIE = 'kitchen_screen';
/** Chrome's ceiling for a cookie's lifetime; re-signed on every check, so it never runs out in use. */
export const SCREEN_TOKEN_TTL_SECONDS = 400 * 24 * 60 * 60;
export const PAIR_CODE_TTL_MINUTES = 10;
/** The saved copies' safety re-read: covers a write the hook could not report. */
export const SAFETY_REVALIDATE_SECONDS = 2 * 60 * 60;

const purpose = (version: number) => `kitchen:${version}`;
const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

/** Part of every cache key, so a deploy never reads a copy shaped by older code. */
export function cacheEpoch(): string {
  return process.env.VERCEL_DEPLOYMENT_ID ?? 'local';
}

/** A fresh one-time code; it replaces any earlier unspent one. */
export async function startPairing(groupId: number): Promise<{ code: string; expiresAt: Date }> {
  const code = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MINUTES * 60_000);
  await db
    .update(groups)
    .set({ kitchenPairCodeHash: hashCode(code), kitchenPairExpiresAt: expiresAt })
    .where(eq(groups.id, groupId));
  return { code, expiresAt };
}

/** Spends a code. One atomic UPDATE, so two phones racing the same code can't both win. */
export async function claimPairing(code: string): Promise<{ groupId: number; version: number } | null> {
  if (!code) return null;
  const [row] = await db
    .update(groups)
    .set({ kitchenPairCodeHash: null, kitchenPairExpiresAt: null })
    .where(and(eq(groups.kitchenPairCodeHash, hashCode(code)), gt(groups.kitchenPairExpiresAt, sql`now()`)))
    .returning({ groupId: groups.id, version: groups.kitchenKeyVersion });
  return row ?? null;
}

export async function disconnectScreens(groupId: number): Promise<void> {
  await db
    .update(groups)
    .set({
      kitchenKeyVersion: sql`${groups.kitchenKeyVersion} + 1`,
      kitchenPairCodeHash: null,
      kitchenPairExpiresAt: null,
    })
    .where(eq(groups.id, groupId));
}

/** The cookie value: `<key version>:<signed token>`. The version travels in the clear only so the signature can be checked against it first. */
export function signScreenToken(groupId: number, version: number): string {
  return `${version}:${signExportToken(groupId, SCREEN_TOKEN_TTL_SECONDS, purpose(version))}`;
}

export async function readKeyVersion(groupId: number): Promise<number | null> {
  const [row] = await db
    .select({ version: groups.kitchenKeyVersion })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return row ? row.version : null;
}

// Checked on every state request, so it comes from the saved copy; a
// disconnect is a write, which marks it stale like everything else.
const cachedKeyVersion = (groupId: number) =>
  unstable_cache(() => readKeyVersion(groupId), ['kitchen-key', String(groupId), cacheEpoch()], {
    tags: [DATA_TAG],
    revalidate: SAFETY_REVALIDATE_SECONDS,
  })();

/**
 * The screen a cookie belongs to, or null. The signature is checked first and
 * is pure crypto: the claimed version picks the purpose it must have been
 * signed for, and only a cookie that passes that reaches getVersion (the
 * cached database read), so garbage or forged cookies never cost a lookup.
 * Then the claimed version must still be the group's current one, which is
 * what a disconnect changes.
 */
export async function verifyScreenToken(
  value: string,
  getVersion: (groupId: number) => Promise<number | null> = cachedKeyVersion
): Promise<{ groupId: number; version: number } | null> {
  const colon = value.indexOf(':');
  if (colon <= 0) return null;
  const claimed = value.slice(0, colon);
  const version = Number(claimed);
  // Canonical digits only ("00", "0.5", "-1" are not what signScreenToken writes).
  if (!Number.isSafeInteger(version) || version < 0 || String(version) !== claimed) return null;
  const groupId = verifyExportToken(value.slice(colon + 1), purpose(version));
  if (groupId === null) return null;
  return (await getVersion(groupId)) === version ? { groupId, version } : null;
}

export function screenCookie(value: string) {
  return {
    name: KITCHEN_COOKIE,
    value,
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SCREEN_TOKEN_TTL_SECONDS,
  };
}
