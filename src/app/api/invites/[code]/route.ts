import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { groupInvites, groups, groupMembers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';
import { notifyMemberJoined } from '@/lib/notifications';

function getInviteCode(url: string): string {
  return new URL(url).pathname.split('/').pop()!;
}

export const GET = withAuth(async (request) => {
  const code = getInviteCode(request.url);

  const [invite] = await db
    .select({
      id: groupInvites.id,
      groupName: groups.name,
      role: groupInvites.role,
      status: groupInvites.status,
      expiresAt: groupInvites.expiresAt,
    })
    .from(groupInvites)
    .innerJoin(groups, eq(groupInvites.groupId, groups.id))
    .where(eq(groupInvites.inviteCode, code))
    .limit(1);

  if (!invite) return errorResponse('Invite not found', 404);

  return jsonResponse({ invite });
});

const respondSchema = z.object({
  action: z.enum(['accept', 'decline']),
});

export const POST = withAuth(async (request, auth) => {
  const code = getInviteCode(request.url);

  const body = await request.json();
  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [invite] = await db
    .select()
    .from(groupInvites)
    .where(eq(groupInvites.inviteCode, code))
    .limit(1);

  if (!invite) return errorResponse('Invite not found', 404);
  if (invite.status !== 'pending') {
    return errorResponse(`Invite already ${invite.status}`, 400);
  }
  if (new Date() > invite.expiresAt) {
    await db
      .update(groupInvites)
      .set({ status: 'expired' })
      .where(eq(groupInvites.id, invite.id));
    return errorResponse('Invite expired', 400);
  }

  if (parsed.data.action === 'decline') {
    await db
      .update(groupInvites)
      .set({ status: 'declined' })
      .where(eq(groupInvites.id, invite.id));
    return jsonResponse({ success: true, action: 'declined' });
  }

  // Accept: check if already a member
  const existing = auth.memberships.find(
    (m) => m.groupId === invite.groupId
  );
  if (existing) {
    return errorResponse('Already a member of this group', 400);
  }

  // Add member
  await db.insert(groupMembers).values({
    groupId: invite.groupId,
    userId: auth.dbUser.id,
    role: invite.role,
  });

  // Mark invite as accepted
  await db
    .update(groupInvites)
    .set({ status: 'accepted' })
    .where(eq(groupInvites.id, invite.id));

  // Notify owner
  await notifyMemberJoined(invite.groupId, {
    memberName: auth.dbUser.name,
    role: invite.role,
  });

  return jsonResponse({ success: true, action: 'accepted', groupId: invite.groupId });
});
