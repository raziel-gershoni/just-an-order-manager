import { withGroup, jsonResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';

export const GET = withGroup(async (_request, _auth, groupId) => {
  const types = await db
    .select()
    .from(breadTypes)
    .where(and(eq(breadTypes.groupId, groupId), eq(breadTypes.isActive, true)))
    .orderBy(asc(breadTypes.sortOrder));

  return jsonResponse({ breadTypes: types });
});
