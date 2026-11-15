import { db } from '@/db';
import { changeProposals, groupMembers, users } from '@/db/schema';
import { and, eq, lte, gt, sql } from 'drizzle-orm';
import { t } from '@/lib/i18n';
import { KINDS, sameBefore } from './kinds';
import type { ProposalInput, ProposalKind } from './types';

/**
 * The proposal store and its decisions. A proposal is created pending, expires
 * lazily (checked whenever it is read or decided, no cron), and is decided at
 * most once: every state change is one atomic UPDATE guarded by the status it
 * expects, so a double tap or two people pressing at once write only once.
 * Only a bakery owner can decide; the check is made here, from the member list.
 */

export const PROPOSAL_TTL_DAYS = 7;

type ProposalStatus = (typeof changeProposals.$inferSelect)['status'];

export type ProposalView = {
  id: number;
  kind: ProposalKind;
  status: ProposalStatus;
  summaryHe: string;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
};

export type DecisionResult =
  | { outcome: 'applied' | 'rejected'; messageHe: string }
  | {
      outcome: 'not_owner' | 'not_found' | 'already_decided' | 'expired' | 'stale' | 'failed';
      messageHe: string;
    };

type Row = typeof changeProposals.$inferSelect;

function view(r: Row): ProposalView {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    summaryHe: r.summaryHe,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  };
}

export async function createProposal(
  groupId: number,
  input: ProposalInput
): Promise<{ ok: true; proposal: ProposalView } | { ok: false; error: string }> {
  const prep = await KINDS[input.kind].prepare(groupId, input);
  if (!prep.ok) return { ok: false, error: prep.error };
  const { target, before, after, summaryHe } = prep.prepared;
  const [row] = await db
    .insert(changeProposals)
    .values({
      groupId,
      kind: input.kind,
      target,
      before,
      after,
      summaryHe,
      expiresAt: sql`now() + make_interval(days => ${PROPOSAL_TTL_DAYS})`,
    })
    .returning();
  console.log(`[mcp] proposal ${row.id} created group=${groupId} kind=${input.kind}`);
  return { ok: true, proposal: view(row) };
}

/** pending → expired for a proposal whose time ran out. True when this call did it. */
async function expireIfDue(groupId: number, id: number): Promise<boolean> {
  const expired = await db
    .update(changeProposals)
    .set({ status: 'expired' })
    .where(
      and(
        eq(changeProposals.id, id),
        eq(changeProposals.groupId, groupId),
        eq(changeProposals.status, 'pending'),
        lte(changeProposals.expiresAt, sql`now()`)
      )
    )
    .returning({ id: changeProposals.id });
  return expired.length > 0;
}

async function loadRow(groupId: number, id: number): Promise<Row | null> {
  const [row] = await db
    .select()
    .from(changeProposals)
    .where(and(eq(changeProposals.id, id), eq(changeProposals.groupId, groupId)));
  return row ?? null;
}

export async function getProposal(groupId: number, id: number): Promise<ProposalView | null> {
  await expireIfDue(groupId, id);
  const row = await loadRow(groupId, id);
  return row ? view(row) : null;
}

/**
 * users.id of this Telegram account when it is an owner of the bakery, else
 * null. users.telegram_id is a varchar, so the id is compared as a string
 * whether the caller sent a number or a string.
 */
export async function ownerUserId(
  groupId: number,
  telegramUserId: string | number
): Promise<number | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
    .where(
      and(
        eq(users.telegramId, String(telegramUserId)),
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.role, 'owner')
      )
    )
    .orderBy(users.id)
    .limit(1);
  return row?.id ?? null;
}

function done(
  proposalId: number,
  groupId: number,
  kind: ProposalKind | null,
  decision: 'approve' | 'reject',
  outcome: DecisionResult['outcome'],
  messageKey: string,
  detail?: string
): DecisionResult {
  console.log(
    `[mcp-decision] proposal=${proposalId} group=${groupId} kind=${kind ?? '-'} decision=${decision} outcome=${outcome}${detail ? ` detail=${detail}` : ''}`
  );
  return { outcome, messageHe: t(messageKey) };
}

export async function decideProposal(
  groupId: number,
  id: number,
  telegramUserId: string | number,
  decision: 'approve' | 'reject'
): Promise<DecisionResult> {
  const row = await loadRow(groupId, id);
  if (!row) return done(id, groupId, null, decision, 'not_found', 'mcp.decision_not_found');

  const userId = await ownerUserId(groupId, telegramUserId);
  if (userId === null) return done(id, groupId, row.kind, decision, 'not_owner', 'mcp.decision_not_owner');

  if (row.status === 'expired' || (await expireIfDue(groupId, id))) {
    return done(id, groupId, row.kind, decision, 'expired', 'mcp.decision_expired');
  }

  // The one atomic step that makes a decision happen once. Approve parks the row
  // in `applying` while the write runs; reject finishes in one go.
  const claimed = await db
    .update(changeProposals)
    .set({
      status: decision === 'approve' ? 'applying' : 'rejected',
      decidedByUserId: userId,
      decidedAt: sql`now()`,
    })
    .where(
      and(
        eq(changeProposals.id, id),
        eq(changeProposals.groupId, groupId),
        eq(changeProposals.status, 'pending'),
        gt(changeProposals.expiresAt, sql`now()`)
      )
    )
    .returning({ id: changeProposals.id });

  if (claimed.length === 0) {
    // Someone decided first, or the clock ran out between the check and the claim.
    const now = await loadRow(groupId, id);
    if (!now || now.status === 'expired' || now.status === 'pending') {
      if (now?.status === 'pending') await expireIfDue(groupId, id);
      return done(id, groupId, row.kind, decision, 'expired', 'mcp.decision_expired');
    }
    return done(id, groupId, row.kind, decision, 'already_decided', 'mcp.decision_already');
  }

  if (decision === 'reject') {
    return done(id, groupId, row.kind, decision, 'rejected', 'mcp.decision_rejected');
  }

  const finish = async (status: 'applied' | 'stale' | 'failed', error: string | null) => {
    await db
      .update(changeProposals)
      .set({ status, error })
      .where(
        and(
          eq(changeProposals.id, id),
          eq(changeProposals.groupId, groupId),
          eq(changeProposals.status, 'applying')
        )
      );
  };

  const kind = KINDS[row.kind];
  const target = row.target as Record<string, unknown>;
  let applied = false;
  try {
    const current = await kind.readBefore(groupId, target);
    if (!sameBefore(current, row.before)) {
      await finish('stale', 'changed since proposed');
      return done(id, groupId, row.kind, decision, 'stale', 'mcp.decision_stale');
    }
    const written = await kind.apply(groupId, target, row.after);
    if (!written.ok) {
      await finish('failed', written.error);
      return done(id, groupId, row.kind, decision, 'failed', 'mcp.decision_failed', `status=${written.status}`);
    }
    applied = true;
    await finish('applied', null);
    return done(id, groupId, row.kind, decision, 'applied', 'mcp.decision_applied');
  } catch (err) {
    // Drizzle's own message embeds the query and its parameters (prices, recipe
    // numbers): keep only the underlying cause, in the log and in the row.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const message = cause instanceof Error ? cause.message : String(cause);
    if (applied) {
      // The change is saved; only the bookkeeping failed. Never tell the owner
      // "nothing changed" about a saved change: the row stays `applying` in the log.
      console.error(`[mcp-decision] proposal=${id} group=${groupId} applied but could not record it: ${message}`);
      return done(id, groupId, row.kind, decision, 'applied', 'mcp.decision_applied', 'unrecorded');
    }
    console.error(`[mcp-decision] proposal=${id} group=${groupId} apply threw: ${message}`);
    // A throw is not proof that nothing was written: a deal is a delete then an
    // insert, and a neon-http statement can commit with its response lost. Only
    // say "nothing changed" when the value still reads as it did.
    let untouched = false;
    try {
      untouched = sameBefore(await kind.readBefore(groupId, target), row.before);
    } catch (readErr) {
      console.error(`[mcp-decision] proposal=${id} could not re-read after the failure:`, readErr instanceof Error ? readErr.message : readErr);
    }
    try {
      await finish('failed', untouched ? message : `${message} (value no longer matches before; check it)`);
    } catch (finishErr) {
      console.error(`[mcp-decision] proposal=${id} could not record the failure:`, finishErr instanceof Error ? finishErr.message : finishErr);
    }
    return untouched
      ? done(id, groupId, row.kind, decision, 'failed', 'mcp.decision_failed', 'threw')
      : done(id, groupId, row.kind, decision, 'failed', 'mcp.decision_uncertain', 'threw, value changed');
  }
}
