import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { reminderTemplates } from '@/db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { z } from 'zod/v4';

export const GET = withGroup(async (_request, _auth, groupId) => {
  const templates = await db
    .select()
    .from(reminderTemplates)
    .where(eq(reminderTemplates.groupId, groupId))
    .orderBy(asc(reminderTemplates.occasion), asc(reminderTemplates.sortOrder));
  return jsonResponse({ templates });
});

const createSchema = z.object({
  label: z.string().min(1).max(255),
  metaTemplateName: z.string().min(1).max(255),
  occasion: z.enum(['week_start', 'shabbat']),
  bodyPreview: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const POST = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if ((membership?.role === 'baker' || membership?.role === 'driver')) {
    return errorResponse('Bakers cannot manage reminders', 403);
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${reminderTemplates.sortOrder}), -1)` })
    .from(reminderTemplates)
    .where(eq(reminderTemplates.groupId, groupId));

  const [template] = await db
    .insert(reminderTemplates)
    .values({
      groupId,
      label: parsed.data.label,
      metaTemplateName: parsed.data.metaTemplateName,
      occasion: parsed.data.occasion,
      bodyPreview: parsed.data.bodyPreview ?? null,
      isActive: parsed.data.isActive ?? true,
      sortOrder: maxSort + 1,
    })
    .returning();

  return jsonResponse({ template }, 201);
});
