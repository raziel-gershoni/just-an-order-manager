import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { customers, customerPhones } from '@/db/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { z } from 'zod/v4';

export const GET = withGroup(async (request, _auth, groupId) => {
  const url = new URL(request.url);
  const activeOnly = url.searchParams.get('active') !== 'false';

  const conditions = [eq(customers.groupId, groupId)];
  if (activeOnly) conditions.push(eq(customers.isActive, true));

  const rows = await db
    .select()
    .from(customers)
    .where(and(...conditions))
    .orderBy(asc(customers.name));

  // Bring in all phones for these customers in one query
  const customerIds = rows.map((c) => c.id);
  const phones = customerIds.length
    ? await db
        .select()
        .from(customerPhones)
        .where(inArray(customerPhones.customerId, customerIds))
        .orderBy(asc(customerPhones.sortOrder))
    : [];

  const phonesByCustomer: Record<number, { id: number; phone: string; sortOrder: number }[]> = {};
  for (const p of phones) {
    if (!phonesByCustomer[p.customerId]) phonesByCustomer[p.customerId] = [];
    phonesByCustomer[p.customerId].push({ id: p.id, phone: p.phone, sortOrder: p.sortOrder });
  }

  const result = rows.map((c) => ({
    ...c,
    phones: phonesByCustomer[c.id] ?? [],
  }));

  return jsonResponse({ customers: result });
});

const createCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().max(50).optional(),  // single starter phone for convenience
  address: z.string().max(500).optional(),
  city: z.string().max(255).optional(),
  telegramChatId: z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
  deliveryNotes: z.string().max(1000).optional(),
});

export const POST = withGroup(async (request, _auth, groupId) => {
  const body = await request.json();
  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const { phone, ...customerData } = parsed.data;

  const [customer] = await db
    .insert(customers)
    .values({ ...customerData, groupId })
    .returning();

  // If a phone was provided at creation time, insert it as the first phone
  if (phone && phone.trim()) {
    await db.insert(customerPhones).values({
      customerId: customer.id,
      phone: phone.trim(),
      sortOrder: 0,
    });
  }

  return jsonResponse({ customer: { ...customer, phones: phone ? [{ phone: phone.trim() }] : [] } }, 201);
});
