import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { groupInvites } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod/v4';
import { INVITE_EXPIRY_DAYS } from '@/lib/constants';

function getGroupId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  const idx = parts.indexOf('groups');
  return Number(parts[idx + 1]);
}

const createInviteSchema = z.object({
  role: z.enum(['manager', 'baker']),
});

export const GET = withAuth(async (request, auth) => {
  const groupId = getGroupId(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);

  const invites = await db
    .select()
    .from(groupInvites)
    .where(eq(groupInvites.groupId, groupId));

  return jsonResponse({ invites });
});

export const POST = withAuth(async (request, auth) => {
  const groupId = getGroupId(request.url);
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if (membership.role === 'baker') {
    return errorResponse('Bakers cannot create invites', 403);
  }

  const body = await request.json();
  const parsed = createInviteSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const inviteCode = nanoid(12);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

  const [invite] = await db
    .insert(groupInvites)
    .values({
      groupId,
      invitedBy: auth.dbUser.id,
      inviteCode,
      role: parsed.data.role,
      expiresAt,
    })
    .returning();

  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME;
  const inviteLink = botUsername
    ? `https://t.me/${botUsername}?start=invite_${inviteCode}`
    : null;

  return jsonResponse({ invite, inviteLink }, 201);
});
