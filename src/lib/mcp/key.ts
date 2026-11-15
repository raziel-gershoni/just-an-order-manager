import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { groups } from '@/db/schema';

/**
 * A bakery's MCP key: one per bakery, sent as `Authorization: Bearer <key>` to
 * /api/mcp and the proposal endpoints. Only its SHA-256 is stored (like the
 * kitchen pairing code), so the key is shown once, when it is issued. The hash
 * lookup is the comparison: the key text is never compared against a stored one.
 */

export const MCP_KEY_PREFIX = 'bmcp_';

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** A fresh key; it replaces any earlier one, which stops working at once. */
export async function issueMcpKey(groupId: number): Promise<{ key: string; createdAt: Date }> {
  const key = MCP_KEY_PREFIX + randomBytes(32).toString('base64url');
  const [row] = await db
    .update(groups)
    .set({ mcpKeyHash: hashKey(key), mcpKeyCreatedAt: sql`now()` })
    .where(eq(groups.id, groupId))
    .returning({ createdAt: groups.mcpKeyCreatedAt });
  if (!row?.createdAt) throw new Error(`[mcp] no bakery ${groupId} to issue a key for`);
  return { key, createdAt: row.createdAt };
}

export async function revokeMcpKey(groupId: number): Promise<void> {
  await db.update(groups).set({ mcpKeyHash: null, mcpKeyCreatedAt: null }).where(eq(groups.id, groupId));
}

/** The bakery a `Bearer bmcp_…` header belongs to, or null for anything else. */
export async function groupForBearer(header: string | null): Promise<number | null> {
  const match = /^Bearer\s+(bmcp_\S+)$/i.exec(header?.trim() ?? '');
  if (!match) return null;
  const [row] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.mcpKeyHash, hashKey(match[1])))
    .limit(1);
  return row?.id ?? null;
}
