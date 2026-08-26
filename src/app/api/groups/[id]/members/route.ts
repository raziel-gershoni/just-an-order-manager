import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { groupMembers, users } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';

function getGroupId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  const idx = parts.indexOf('groups');
  return Number(parts[idx + 1]);
}

export const GET = withAuth(async (request, auth) => {
  const groupId = getGroupId(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);

  const members = await db
    .select({
      id: groupMembers.id,
      userId: users.id,
      name: users.name,
      telegramId: users.telegramId,
      role: groupMembers.role,
      joinedAt: groupMembers.joinedAt,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId));

  return jsonResponse({ members });
});

export const DELETE = withAuth(async (request, auth) => {
  const groupId = getGroupId(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if (membership.role !== 'owner') return errorResponse('Only owner can remove members', 403);

  const { userId } = await request.json();
  if (!Number.isInteger(userId)) return errorResponse('Invalid user id', 400);
  if (userId === auth.dbUser.id) return errorResponse('Cannot remove yourself', 400);

  // Release their customers in the same statement. customers.handler_user_id
  // points at `users`, not at the membership, so removing someone would
  // otherwise leave their customers marked as handled by a person the picker
  // can no longer name — and nothing else would ever clean that up. One
  // statement because neon-http has no interactive transactions; the two halves
  // touch different tables, so sharing a snapshot is safe.
  await db.execute(sql`
    WITH released AS (
      UPDATE customers SET handler_user_id = NULL, updated_at = now()
      WHERE group_id = ${groupId} AND handler_user_id = ${userId}
    )
    DELETE FROM group_members
    WHERE group_id = ${groupId} AND user_id = ${userId}
  `);

  return jsonResponse({ success: true });
});
