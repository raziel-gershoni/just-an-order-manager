import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { customers } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { z } from 'zod/v4';

export const GET = withGroup(async (request, _auth, groupId) => {
  const url = new URL(request.url);
  const activeOnly = url.searchParams.get('active') !== 'false';

  const conditions = [eq(customers.groupId, groupId)];
  if (activeOnly) conditions.push(eq(customers.isActive, true));

  const result = await db
    .select()
    .from(customers)
    .where(and(...conditions))
    .orderBy(asc(customers.name));

  return jsonResponse({ customers: result });
});

const createCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().max(50).optional(),
  telegramChatId: z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
});

export const POST = withGroup(async (request, _auth, groupId) => {
  const body = await request.json();
  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [customer] = await db
    .insert(customers)
    .values({ ...parsed.data, groupId })
    .returning();

  return jsonResponse({ customer }, 201);
});
