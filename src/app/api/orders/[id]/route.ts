import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, customers, breadTypes } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';

function getOrderId(url: string): number {
  return Number(new URL(url).pathname.split('/').at(-1));
}

export const GET = withGroup(async (request, _auth, groupId) => {
  const id = getOrderId(request.url);

  const [order] = await db
    .select({
      id: orders.id,
      quantity: orders.quantity,
      deliveryType: orders.deliveryType,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      pricePerUnit: orders.pricePerUnit,
      notes: orders.notes,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      customerName: customers.name,
      customerId: customers.id,
      breadTypeName: breadTypes.name,
      breadTypeId: breadTypes.id,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .innerJoin(breadTypes, eq(orders.breadTypeId, breadTypes.id))
    .where(and(eq(orders.id, id), eq(orders.groupId, groupId)))
    .limit(1);

  if (!order) return errorResponse('Order not found', 404);
  return jsonResponse({ order });
});

const updateOrderSchema = z.object({
  quantity: z.number().int().positive().optional(),
  breadTypeId: z.number().int().positive().optional(),
  deliveryType: z.enum(['weekly', 'shabbat', 'specific_date', 'asap']).optional(),
  deliveryDate: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export const PATCH = withGroup(async (request, _auth, groupId) => {
  const id = getOrderId(request.url);

  const body = await request.json();
  const parsed = updateOrderSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [updated] = await db
    .update(orders)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.groupId, groupId)))
    .returning();

  if (!updated) return errorResponse('Order not found', 404);
  return jsonResponse({ order: updated });
});
