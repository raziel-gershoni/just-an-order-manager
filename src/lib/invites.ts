import { db } from '@/db';
import { groupInvites, groupMembers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { notifyMemberJoined } from './notifications';

export type InviteResponseResult =
  | { ok: true; action: 'accepted'; groupId: number; role: string }
  | { ok: true; action: 'declined' }
  | { ok: false; status: number; error: string; code: 'not_found' | 'not_pending' | 'expired' | 'already_member' };

/**
 * Respond to a group invite (accept/decline) — the one place the invite
 * lifecycle guards live, shared by the web invite route and the Telegram
 * accept/decline buttons so neither can skip the pending/expiry/already-member
 * checks. Membership is checked against the DB (not a cached session list) so it
 * is correct regardless of caller.
 */
export async function respondToInvite(
  inviteCode: string,
  action: 'accept' | 'decline',
  user: { id: number; name: string }
): Promise<InviteResponseResult> {
  const [invite] = await db
    .select()
    .from(groupInvites)
    .where(eq(groupInvites.inviteCode, inviteCode))
    .limit(1);

  if (!invite) return { ok: false, status: 404, error: 'Invite not found', code: 'not_found' };
  if (invite.status !== 'pending') {
    return { ok: false, status: 400, error: `Invite already ${invite.status}`, code: 'not_pending' };
  }
  if (new Date() > invite.expiresAt) {
    await db.update(groupInvites).set({ status: 'expired' }).where(eq(groupInvites.id, invite.id));
    return { ok: false, status: 400, error: 'Invite expired', code: 'expired' };
  }

  if (action === 'decline') {
    await db.update(groupInvites).set({ status: 'declined' }).where(eq(groupInvites.id, invite.id));
    return { ok: true, action: 'declined' };
  }

  // Accept: reject if already a member of the target group.
  const [existing] = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, user.id), eq(groupMembers.groupId, invite.groupId)))
    .limit(1);
  if (existing) {
    return { ok: false, status: 400, error: 'Already a member of this group', code: 'already_member' };
  }

  await db.insert(groupMembers).values({ groupId: invite.groupId, userId: user.id, role: invite.role });
  await db.update(groupInvites).set({ status: 'accepted' }).where(eq(groupInvites.id, invite.id));
  await notifyMemberJoined(invite.groupId, { memberName: user.name, role: invite.role });

  return { ok: true, action: 'accepted', groupId: invite.groupId, role: invite.role };
}
