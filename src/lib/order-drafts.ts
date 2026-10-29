import { nanoid } from 'nanoid';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orderDrafts } from '@/db/schema';

export type DraftStatus = 'pending' | 'ready' | 'empty' | 'failed' | 'used';
export type DraftRow = typeof orderDrafts.$inferSelect;
export const DRAFT_TTL_DAYS = 7;

/**
 * One draft per Telegram message. Telegram re-sends an update it thinks failed,
 * so the insert is the dedupe: a second copy gets no row back and stops there.
 * Old drafts are pruned here rather than by a scheduled job.
 */
export async function createDraft(v: {
  groupId: number;
  createdBy: number;
  source: 'voice' | 'text';
  tgChatId: number;
  tgMessageId: number;
}): Promise<{ id: string } | null> {
  const [row] = await db
    .insert(orderDrafts)
    .values({ id: nanoid(), ...v })
    .onConflictDoNothing({ target: [orderDrafts.tgChatId, orderDrafts.tgMessageId] })
    .returning({ id: orderDrafts.id });
  try {
    await db
      .delete(orderDrafts)
      .where(lt(orderDrafts.createdAt, sql`now() - make_interval(days => ${DRAFT_TTL_DAYS})`));
  } catch (e) {
    // The draft itself is saved; a failed prune only leaves old rows for the next insert.
    console.error('[order-draft] prune failed', e);
  }
  return row ?? null;
}

/** Remembers the "מפענח…" message so the summary can replace it later. */
export async function setDraftReply(id: string, replyMessageId: number): Promise<void> {
  await db.update(orderDrafts).set({ replyMessageId }).where(eq(orderDrafts.id, id));
}

export async function finishDraft(
  id: string,
  r: {
    status: 'ready' | 'empty' | 'failed';
    transcript?: string | null;
    draft?: unknown;
    error?: string | null;
  }
): Promise<void> {
  await db
    .update(orderDrafts)
    .set({
      status: r.status,
      transcript: r.transcript ?? null,
      draft: r.draft ?? null,
      error: r.error ?? null,
    })
    .where(eq(orderDrafts.id, id));
}

export async function getDraft(id: string): Promise<DraftRow | null> {
  const [row] = await db.select().from(orderDrafts).where(eq(orderDrafts.id, id)).limit(1);
  return row ?? null;
}

/** A draft's link stops working after DRAFT_TTL_DAYS, even before the prune removes the row. */
export function isDraftFresh(row: { createdAt: Date }, now: Date = new Date()): boolean {
  return row.createdAt.getTime() >= now.getTime() - DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Takes the draft for one save. A single UPDATE that only matches a `ready`
 * draft of this bakery, so two saves racing each other can't both win and make
 * two orders (neon-http has no transactions to lean on).
 */
export async function claimDraft(id: string, groupId: number): Promise<boolean> {
  const rows = await db
    .update(orderDrafts)
    .set({ status: 'used' })
    .where(and(eq(orderDrafts.id, id), eq(orderDrafts.groupId, groupId), eq(orderDrafts.status, 'ready')))
    .returning({ id: orderDrafts.id });
  return rows.length > 0;
}

/**
 * Puts a claimed draft back after a failed save. Only while no order is
 * attached: once an order exists the draft stays used.
 */
export async function releaseDraft(id: string): Promise<void> {
  await db
    .update(orderDrafts)
    .set({ status: 'ready' })
    .where(and(eq(orderDrafts.id, id), eq(orderDrafts.status, 'used'), isNull(orderDrafts.orderId)));
}

/**
 * Drafts of this chat still `pending` well past the bot route's 300 s ceiling:
 * the platform ended that run before it could say anything, so they are marked
 * failed for the sender to be told. Returns their "מפענח…" messages.
 */
export async function failStaleDrafts(tgChatId: number): Promise<{ id: string; replyMessageId: number | null }[]> {
  return db
    .update(orderDrafts)
    .set({ status: 'failed', error: 'timed_out' })
    .where(
      and(
        eq(orderDrafts.tgChatId, tgChatId),
        eq(orderDrafts.status, 'pending'),
        lt(orderDrafts.createdAt, sql`now() - interval '6 minutes'`)
      )
    )
    .returning({ id: orderDrafts.id, replyMessageId: orderDrafts.replyMessageId });
}

export async function attachDraftOrder(id: string, orderId: number): Promise<void> {
  await db.update(orderDrafts).set({ orderId }).where(eq(orderDrafts.id, id));
}
