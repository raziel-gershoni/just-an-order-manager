import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { reminderTemplates, reminderSends } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';

function getId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  return Number(parts[parts.length - 1]);
}

const updateSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  metaTemplateName: z.string().min(1).max(255).optional(),
  occasion: z.enum(['week_start', 'shabbat']).optional(),
  bodyPreview: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const PATCH = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (membership?.role === 'baker') {
    return errorResponse('Bakers cannot manage reminders', 403);
  }
  const id = getId(request.url);
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [template] = await db
    .update(reminderTemplates)
    .set(parsed.data)
    .where(and(eq(reminderTemplates.id, id), eq(reminderTemplates.groupId, groupId)))
    .returning();
  if (!template) return errorResponse('Template not found', 404);
  return jsonResponse({ template });
});

export const DELETE = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (membership?.role === 'baker') {
    return errorResponse('Bakers cannot manage reminders', 403);
  }
  const id = getId(request.url);

  // Hard delete only when no send history references it; otherwise pause instead
  // (templateId is a NOT NULL FK in reminder_sends).
  const [used] = await db
    .select({ id: reminderSends.id })
    .from(reminderSends)
    .where(eq(reminderSends.templateId, id))
    .limit(1);
  if (used) {
    return errorResponse('Template has send history — pause it instead', 409);
  }

  const [deleted] = await db
    .delete(reminderTemplates)
    .where(and(eq(reminderTemplates.id, id), eq(reminderTemplates.groupId, groupId)))
    .returning({ id: reminderTemplates.id });
  if (!deleted) return errorResponse('Template not found', 404);
  return jsonResponse({ success: true });
});
