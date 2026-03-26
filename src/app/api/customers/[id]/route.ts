import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { customers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';

function getCustomerId(url: string): number {
  return Number(new URL(url).pathname.split('/').at(-1));
}

export const GET = withGroup(async (request, _auth, groupId) => {
  const id = getCustomerId(request.url);

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.groupId, groupId)))
    .limit(1);

  if (!customer) return errorResponse('Customer not found', 404);
  return jsonResponse({ customer });
});

const updateCustomerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(255).optional(),
  telegramChatId: z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = withGroup(async (request, _auth, groupId) => {
  const id = getCustomerId(request.url);

  const body = await request.json();
  const parsed = updateCustomerSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [updated] = await db
    .update(customers)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(customers.id, id), eq(customers.groupId, groupId)))
    .returning();

  if (!updated) return errorResponse('Customer not found', 404);
  return jsonResponse({ customer: updated });
});

export const DELETE = withGroup(async (request, _auth, groupId) => {
  const id = getCustomerId(request.url);

  // Soft-delete
  const [updated] = await db
    .update(customers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(customers.id, id), eq(customers.groupId, groupId)))
    .returning();

  if (!updated) return errorResponse('Customer not found', 404);
  return jsonResponse({ customer: updated });
});
