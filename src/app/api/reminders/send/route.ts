import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { reminderTemplates, reminderSends, customers, customerPhones } from '@/db/schema';
import { eq, and, asc, desc, inArray } from 'drizzle-orm';
import { z } from 'zod/v4';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';
import { pickNextTemplate } from '@/lib/reminders';

const sendSchema = z
  .object({
    occasion: z.enum(['week_start', 'shabbat']),
    customerIds: z.array(z.number().int().positive()).optional(),
    phoneId: z.number().int().positive().optional(),
  })
  .refine((d) => d.phoneId != null || (d.customerIds && d.customerIds.length > 0), {
    message: 'Provide phoneId or customerIds',
  });

export const POST = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (membership?.role === 'baker') {
    return errorResponse('Bakers cannot send reminders', 403);
  }

  const body = await request.json();
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);
  const { occasion } = parsed.data;

  // Active templates for this occasion, in rotation order.
  const templates = await db
    .select()
    .from(reminderTemplates)
    .where(
      and(
        eq(reminderTemplates.groupId, groupId),
        eq(reminderTemplates.occasion, occasion),
        eq(reminderTemplates.isActive, true)
      )
    )
    .orderBy(asc(reminderTemplates.sortOrder));
  if (templates.length === 0) {
    return errorResponse('No active templates for this occasion', 400);
  }

  // Resolve the target phones, grouped by customer.
  type Target = {
    customerId: number;
    phoneId: number;
    phone: string;
  };
  let targets: Target[] = [];
  let skippedOptOut = 0;

  if (parsed.data.phoneId != null) {
    const [row] = await db
      .select({
        phoneId: customerPhones.id,
        phone: customerPhones.phone,
        customerId: customers.id,
        optOut: customers.reminderOptOut,
      })
      .from(customerPhones)
      .innerJoin(customers, eq(customerPhones.customerId, customers.id))
      .where(and(eq(customerPhones.id, parsed.data.phoneId), eq(customers.groupId, groupId)))
      .limit(1);
    if (!row) return errorResponse('Phone not found', 404);
    if (row.optOut) skippedOptOut = 1;
    else targets = [{ customerId: row.customerId, phoneId: row.phoneId, phone: row.phone }];
  } else {
    const ids = parsed.data.customerIds!;
    const custRows = await db
      .select({ id: customers.id, optOut: customers.reminderOptOut })
      .from(customers)
      .where(and(eq(customers.groupId, groupId), inArray(customers.id, ids)));
    const allowed = custRows.filter((c) => !c.optOut);
    skippedOptOut = custRows.length - allowed.length;
    const allowedIds = allowed.map((c) => c.id);
    if (allowedIds.length > 0) {
      const phones = await db
        .select({
          phoneId: customerPhones.id,
          phone: customerPhones.phone,
          customerId: customerPhones.customerId,
        })
        .from(customerPhones)
        .where(inArray(customerPhones.customerId, allowedIds))
        .orderBy(asc(customerPhones.sortOrder));
      targets = phones.map((p) => ({
        customerId: p.customerId,
        phoneId: p.phoneId,
        phone: p.phone,
      }));
    }
  }

  // Resolve the rotated template ONCE per customer (all their phones get it).
  const customerIdsToSend = [...new Set(targets.map((t) => t.customerId))];
  const templateByCustomer = new Map<number, (typeof templates)[number]>();
  for (const cid of customerIdsToSend) {
    const [last] = await db
      .select({ templateId: reminderSends.templateId })
      .from(reminderSends)
      .where(and(eq(reminderSends.customerId, cid), eq(reminderSends.occasion, occasion)))
      .orderBy(desc(reminderSends.sentAt))
      .limit(1);
    const next = pickNextTemplate(templates, last?.templateId ?? null);
    if (next) templateByCustomer.set(cid, next);
  }

  // Send + log, one row per phone.
  let sent = 0;
  let failed = 0;
  const results = await Promise.allSettled(
    targets.map(async (tgt) => {
      const template = templateByCustomer.get(tgt.customerId);
      if (!template) return;
      // No template variables for now — templates send as-is, no name slot.
      const ok = await sendWhatsAppTemplate(tgt.phone, template.metaTemplateName, 'he');
      await db.insert(reminderSends).values({
        groupId,
        customerId: tgt.customerId,
        phoneId: tgt.phoneId,
        templateId: template.id,
        occasion,
        status: ok ? 'sent' : 'failed',
      });
      if (ok) sent += 1;
      else failed += 1;
    })
  );
  // Surface unexpected exceptions (DB insert failures etc.) as failures.
  for (const r of results) if (r.status === 'rejected') failed += 1;

  return jsonResponse({ sent, failed, skippedOptOut });
});
