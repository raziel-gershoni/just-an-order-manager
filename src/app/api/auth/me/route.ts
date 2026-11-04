import { withAuth, jsonResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { groups, groupMembers } from '@/db/schema';
import { asc, eq } from 'drizzle-orm';

export const GET = withAuth(async (_request, auth) => {
  const userGroups = await db
    .select({
      id: groups.id,
      name: groups.name,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, auth.dbUser.id))
    // The app opens on the first one: the lowest group id, the rule the bot and drafts use.
    .orderBy(asc(groupMembers.groupId));

  return jsonResponse({
    user: auth.dbUser,
    groups: userGroups,
  });
});
