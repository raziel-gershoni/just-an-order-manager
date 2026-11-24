import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { groups, groupMembers, breadTypes } from '@/db/schema';
import { z } from 'zod/v4';
import { canCreateGroup } from '@/lib/group-signup';

const createGroupSchema = z.object({
  name: z.string().min(1).max(255),
  defaultBreadType: z.string().min(1).max(255).optional(),
});

export const POST = withAuth(async (request, auth) => {
  if (!(await canCreateGroup())) {
    console.warn('[groups] create refused: a business already exists, joining is by invite only', {
      userId: auth.dbUser.id,
    });
    return errorResponse('Joining is by invite only', 403);
  }

  const body = await request.json();
  const parsed = createGroupSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.message);
  }

  const { name, defaultBreadType } = parsed.data;

  // Create group + owner membership + default bread type in a logical sequence
  const [group] = await db.insert(groups).values({
    name,
    createdBy: auth.dbUser.id,
  }).returning();

  await db.insert(groupMembers).values({
    groupId: group.id,
    userId: auth.dbUser.id,
    role: 'owner',
  });

  // Create a default bread type (sizes are added later via the catalog UI)
  await db.insert(breadTypes).values({
    groupId: group.id,
    name: defaultBreadType || 'Sourdough',
    sortOrder: 0,
  });

  return jsonResponse({ group }, 201);
});
