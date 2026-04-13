import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, breadTypes } from '@/db/schema';
import { eq, and, asc, desc, gte, lte, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod/v4';
import { resolveDeliveryDate } from '@/lib/date-utils';
import { notifyNewOrder, notifyCustomerWhatsApp } from '@/lib/notifications';

export const GET = withGroup(async (request, _auth, groupId) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const active = url.searchParams.get('active');
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  const customerId = url.searchParams.get('customerId');

  const conditions = [eq(orders.groupId, groupId)];
  if (status) conditions.push(eq(orders.status, status as any));
  if (active === 'true') conditions.push(notInArray(orders.status, ['delivered', 'cancelled']));
  if (dateFrom) conditions.push(gte(orders.deliveryDate, dateFrom));
  if (dateTo) conditions.push(lte(orders.deliveryDate, dateTo));
  if (customerId) conditions.push(eq(orders.customerId, Number(customerId)));

  // Get orders
  const orderRows = await db
    .select({
      id: orders.id,
      deliveryType: orders.deliveryType,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      notes: orders.notes,
      createdAt: orders.createdAt,
      customerName: customers.name,
      customerId: customers.id,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(asc(orders.deliveryDate), desc(orders.createdAt));

  // Get items for all these orders
  const orderIds = orderRows.map((o) => o.id);
  let itemsMap: Record<number, { breadTypeName: string; quantity: number; pricePerUnit: string | null }[]> = {};

  if (orderIds.length > 0) {
    const allItems = await db
      .select({
        orderId: orderItems.orderId,
        breadTypeName: breadTypes.name,
        quantity: orderItems.quantity,
        pricePerUnit: orderItems.pricePerUnit,
      })
      .from(orderItems)
      .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
      .where(inArray(orderItems.orderId, orderIds));

    for (const item of allItems) {
      if (!itemsMap[item.orderId]) itemsMap[item.orderId] = [];
      itemsMap[item.orderId].push({
        breadTypeName: item.breadTypeName,
        quantity: item.quantity,
        pricePerUnit: item.pricePerUnit,
      });
    }
  }

  const result = orderRows.map((o) => {
    const items = itemsMap[o.id] || [];
    return {
      ...o,
      items,
      totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
      itemsSummary: items.map((i) => `${i.quantity} ${i.breadTypeName}`).join(', '),
    };
  });

  return jsonResponse({ orders: result });
});

const itemSchema = z.object({
  breadTypeId: z.number().int().positive(),
  quantity: z.number().int().positive().default(1),
});

const createOrderSchema = z.object({
  customerId: z.number().int().positive(),
  deliveryType: z.enum(['weekly', 'shabbat', 'specific_date', 'asap']),
  deliveryDate: z.string().optional(),
  items: z.array(itemSchema).min(1),
  notes: z.string().max(1000).optional(),
});

export const POST = withGroup(async (request, _auth, groupId) => {
  const body = await request.json();
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const { customerId, deliveryType, deliveryDate, items, notes } = parsed.data;

  // Verify customer
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.groupId, groupId)))
    .limit(1);
  if (!customer) return errorResponse('Customer not found', 404);

  // Get bread types for price snapshot
  const allBreadTypes = await db
    .select()
    .from(breadTypes)
    .where(eq(breadTypes.groupId, groupId));
  const btMap = Object.fromEntries(allBreadTypes.map((bt) => [bt.id, bt]));

  for (const item of items) {
    if (!btMap[item.breadTypeId]) {
      return errorResponse(`Bread type ${item.breadTypeId} not found`, 404);
    }
  }

  const resolvedDate = resolveDeliveryDate(deliveryType, deliveryDate);

  // Create order
  const [order] = await db
    .insert(orders)
    .values({
      groupId,
      customerId,
      deliveryType,
      deliveryDate: resolvedDate,
      notes,
    })
    .returning();

  // Create order items
  const itemValues = items.map((item) => ({
    orderId: order.id,
    breadTypeId: item.breadTypeId,
    quantity: item.quantity,
    pricePerUnit: btMap[item.breadTypeId].price,
  }));

  await db.insert(orderItems).values(itemValues);

  // Notify bakers
  const notifItems = items.map((item) => ({
    breadTypeName: btMap[item.breadTypeId].name,
    quantity: item.quantity,
  }));

  await notifyNewOrder(groupId, {
    customerName: customer.name,
    items: notifItems,
    deliveryDate: resolvedDate,
    notes: notes ?? null,
  });

  // WhatsApp notification to customer
  const itemsSummary = notifItems.map((i) => `${i.quantity} ${i.breadTypeName}`).join(', ');
  await notifyCustomerWhatsApp(customer.phone, 'order_received', [`: ${itemsSummary}`]);

  return jsonResponse({ order, items: itemValues }, 201);
});
