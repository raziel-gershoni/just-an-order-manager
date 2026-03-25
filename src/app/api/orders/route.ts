import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, customers, breadTypes } from '@/db/schema';
import { eq, and, asc, desc, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { resolveDeliveryDate } from '@/lib/date-utils';
import { notifyNewOrder } from '@/lib/notifications';

export const GET = withGroup(async (request, _auth, groupId) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  const customerId = url.searchParams.get('customerId');

  const conditions = [eq(orders.groupId, groupId)];
  if (status) conditions.push(eq(orders.status, status as any));
  if (dateFrom) conditions.push(gte(orders.deliveryDate, dateFrom));
  if (dateTo) conditions.push(lte(orders.deliveryDate, dateTo));
  if (customerId) conditions.push(eq(orders.customerId, Number(customerId)));

  const result = await db
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
    .where(and(...conditions))
    .orderBy(asc(orders.deliveryDate), desc(orders.createdAt));

  return jsonResponse({ orders: result });
});

const createOrderSchema = z.object({
  customerId: z.number().int().positive(),
  breadTypeId: z.number().int().positive(),
  quantity: z.number().int().positive().default(1),
  deliveryType: z.enum(['weekly', 'shabbat', 'specific_date', 'asap']),
  deliveryDate: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export const POST = withGroup(async (request, _auth, groupId) => {
  const body = await request.json();
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const { customerId, breadTypeId, quantity, deliveryType, deliveryDate, notes } =
    parsed.data;

  // Verify customer belongs to group
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.groupId, groupId)))
    .limit(1);
  if (!customer) return errorResponse('Customer not found', 404);

  // Get bread type for price snapshot
  const [breadType] = await db
    .select()
    .from(breadTypes)
    .where(and(eq(breadTypes.id, breadTypeId), eq(breadTypes.groupId, groupId)))
    .limit(1);
  if (!breadType) return errorResponse('Bread type not found', 404);

  const resolvedDate = resolveDeliveryDate(deliveryType, deliveryDate);

  const [order] = await db
    .insert(orders)
    .values({
      groupId,
      customerId,
      breadTypeId,
      quantity,
      deliveryType,
      deliveryDate: resolvedDate,
      pricePerUnit: breadType.price, // snapshot price
      notes,
    })
    .returning();

  // Notify bakers
  await notifyNewOrder(groupId, {
    customerName: customer.name,
    breadTypeName: breadType.name,
    quantity,
    deliveryDate: resolvedDate,
    notes: notes ?? null,
  });

  return jsonResponse({ order }, 201);
});
