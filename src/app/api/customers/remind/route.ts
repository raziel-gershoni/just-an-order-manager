import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { customers } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { z } from 'zod/v4';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';

const remindSchema = z.object({
  customerIds: z.array(z.number().int().positive()).optional(),
});

export const POST = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (!membership) return errorResponse('Not a member', 403);
  if (membership.role === 'baker') {
    return errorResponse('Bakers cannot send reminders', 403);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = remindSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const conditions = [eq(customers.groupId, groupId), eq(customers.isActive, true)];
  if (parsed.data.customerIds && parsed.data.customerIds.length > 0) {
    conditions.push(inArray(customers.id, parsed.data.customerIds));
  }

  const targets = await db.select().from(customers).where(and(...conditions));

  const templateName = process.env.WHATSAPP_REMINDER_TEMPLATE || 'order_reminder';

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const results = await Promise.allSettled(
    targets.map(async (c) => {
      if (!c.phone) {
        skipped++;
        return;
      }
      const ok = await sendWhatsAppTemplate(c.phone, templateName, 'he');
      if (ok) sent++;
      else failed++;
    })
  );

  for (const r of results) {
    if (r.status === 'rejected') failed++;
  }

  return jsonResponse({ sent, failed, skipped, total: targets.length });
});
