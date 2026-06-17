import { withAuth, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { customers, customerPhones } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';

function getPhoneId(url: string): number {
  return Number(new URL(url).pathname.split('/').pop());
}

async function authorize(
  phoneId: number,
  auth: { memberships: { groupId: number; role: string }[] }
): Promise<Response | null> {
  const [phone] = await db.select().from(customerPhones).where(eq(customerPhones.id, phoneId)).limit(1);
  if (!phone) return errorResponse('Phone not found', 404);

  const [customer] = await db
    .select({ groupId: customers.groupId })
    .from(customers)
    .where(eq(customers.id, phone.customerId))
    .limit(1);
  if (!customer) return errorResponse('Customer not found', 404);

  const membership = auth.memberships.find((m) => m.groupId === customer.groupId);
  if (!membership) return errorResponse('Not a member', 403);
  return null;
}

const updateSchema = z.object({
  phone: z.string().min(1).max(50).optional(),
  name: z.string().max(255).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const PATCH = withAuth(async (request, auth) => {
  const phoneId = getPhoneId(request.url);
  const denied = await authorize(phoneId, auth);
  if (denied) return denied;

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const updateData: Record<string, unknown> = {};
  if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone.trim();
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name?.trim() || null;
  if (parsed.data.sortOrder !== undefined) updateData.sortOrder = parsed.data.sortOrder;

  const [updated] = await db
    .update(customerPhones)
    .set(updateData)
    .where(eq(customerPhones.id, phoneId))
    .returning();

  return jsonResponse({ phone: updated });
});

export const DELETE = withAuth(async (request, auth) => {
  const phoneId = getPhoneId(request.url);
  const denied = await authorize(phoneId, auth);
  if (denied) return denied;

  await db.delete(customerPhones).where(eq(customerPhones.id, phoneId));
  return jsonResponse({ deleted: true });
});
