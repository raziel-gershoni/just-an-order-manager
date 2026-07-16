import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { groupInvites, groups } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { respondToInvite } from '@/lib/invites';

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

  const result = await respondToInvite(code, parsed.data.action, {
    id: auth.dbUser.id,
    name: auth.dbUser.name,
  });
  if (!result.ok) return errorResponse(result.error, result.status);

  return jsonResponse(
    result.action === 'accepted'
      ? { success: true, action: 'accepted', groupId: result.groupId }
      : { success: true, action: 'declined' }
  );
});
