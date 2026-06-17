import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { customers, customerPhones } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod/v4';

function getCustomerId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  // /api/customers/[id]/phones — id is two segments before "phones"
  const idx = parts.indexOf('phones');
  return Number(parts[idx - 1]);
}

const createSchema = z.object({
  phone: z.string().min(1).max(50),
  name: z.string().max(255).optional(),
});

export const POST = withGroup(async (request, _auth, groupId) => {
  const customerId = getCustomerId(request.url);

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.groupId, groupId)))
    .limit(1);
  if (!customer) return errorResponse('Customer not found', 404);

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${customerPhones.sortOrder}), -1)` })
    .from(customerPhones)
    .where(eq(customerPhones.customerId, customerId));

  const [phone] = await db
    .insert(customerPhones)
    .values({
      customerId,
      phone: parsed.data.phone.trim(),
      name: parsed.data.name?.trim() || null,
      sortOrder: maxSort + 1,
    })
    .returning();

  return jsonResponse({ phone }, 201);
});
