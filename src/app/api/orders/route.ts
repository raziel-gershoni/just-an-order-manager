import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, breadTypes, breadSizes, breadTypeSizes } from '@/db/schema';
import { eq, and, asc, desc, gte, lte, inArray, notInArray } from 'drizzle-orm';
import { formatItemLine } from '@/lib/order-display';
import { z } from 'zod/v4';
import { resolveDeliveryDate } from '@/lib/date-utils';
import { notifyNewOrder, notifyCustomerWhatsApp } from '@/lib/notifications';
import { getCustomerPhones } from '@/lib/customer-phones';

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
      paid: orders.paid,
      isRecurring: orders.isRecurring,
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
  let itemsMap: Record<number, { breadTypeName: string; sizeName: string | null; quantity: number; pricePerUnit: string | null }[]> = {};

  if (orderIds.length > 0) {
    const allItems = await db
      .select({
        orderId: orderItems.orderId,
        breadTypeName: breadTypes.name,
        sizeName: breadSizes.name,
        quantity: orderItems.quantity,
        pricePerUnit: orderItems.pricePerUnit,
      })
      .from(orderItems)
      .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
      .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
      .where(inArray(orderItems.orderId, orderIds));

    for (const item of allItems) {
      if (!itemsMap[item.orderId]) itemsMap[item.orderId] = [];
      itemsMap[item.orderId].push({
        breadTypeName: item.breadTypeName,
        sizeName: item.sizeName,
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
      itemsSummary: items.map((i) => formatItemLine(i.quantity, i.breadTypeName, i.sizeName)).join(', '),
    };
  });

  return jsonResponse({ orders: result });
});

const itemSchema = z.object({
  breadTypeId: z.number().int().positive(),
  breadSizeId: z.number().int().positive(),
  quantity: z.number().int().positive().default(1),
});

const createOrderSchema = z.object({
  customerId: z.number().int().positive(),
  deliveryType: z.enum(['weekly', 'shabbat', 'specific_date', 'asap']),
  deliveryDate: z.string().optional(),
  items: z.array(itemSchema).min(1),
  notes: z.string().max(1000).optional(),
  totalOverride: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  isRecurring: z.boolean().optional(),
  notifyCustomer: z.boolean().optional(),
});

export const POST = withGroup(async (request, _auth, groupId) => {
  const body = await request.json();
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const { customerId, deliveryType, deliveryDate, items, notes, totalOverride, isRecurring, notifyCustomer } = parsed.data;

  // Verify customer
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.groupId, groupId)))
    .limit(1);
  if (!customer) return errorResponse('Customer not found', 404);

  // Validate every (type, size) pair against the junction; resolve effective price
  const allBreadTypes = await db
    .select({ id: breadTypes.id, name: breadTypes.name })
    .from(breadTypes)
    .where(eq(breadTypes.groupId, groupId));
  const btMap = Object.fromEntries(allBreadTypes.map((bt) => [bt.id, bt]));

  const sizeIds = items.map((i) => i.breadSizeId);
  const sizesInGroup = await db
    .select()
    .from(breadSizes)
    .where(and(inArray(breadSizes.id, sizeIds), eq(breadSizes.groupId, groupId)));
  const sizeMap = Object.fromEntries(sizesInGroup.map((s) => [s.id, s]));

  const typeIds = items.map((i) => i.breadTypeId);
  const links = await db
    .select()
    .from(breadTypeSizes)
    .where(
      and(
        inArray(breadTypeSizes.breadTypeId, typeIds),
        inArray(breadTypeSizes.breadSizeId, sizeIds)
      )
    );
  const linkMap = new Map(links.map((l) => [`${l.breadTypeId}:${l.breadSizeId}`, l]));

  const itemValues: typeof orderItems.$inferInsert[] = [];
  for (const item of items) {
    if (!btMap[item.breadTypeId]) {
      return errorResponse(`Bread type ${item.breadTypeId} not found`, 404);
    }
    const size = sizeMap[item.breadSizeId];
    if (!size) {
      return errorResponse(`Bread size ${item.breadSizeId} not found`, 404);
    }
    const link = linkMap.get(`${item.breadTypeId}:${item.breadSizeId}`);
    if (!link) {
      return errorResponse(
        `Size ${item.breadSizeId} not enabled for type ${item.breadTypeId}`,
        400
      );
    }
    const pricePerUnit = link.priceOverride ?? size.price;
    itemValues.push({
      orderId: 0, // placeholder, filled after order insert
      breadTypeId: item.breadTypeId,
      breadSizeId: item.breadSizeId,
      quantity: item.quantity,
      pricePerUnit,
    });
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
      totalOverride: totalOverride || null,
      isRecurring: isRecurring ?? false,
    })
    .returning();

  // Stamp the orderId on each item now that we have it
  for (const iv of itemValues) iv.orderId = order.id;

  await db.insert(orderItems).values(itemValues);

  // Build customer-facing items (name only, no weight) — for WhatsApp
  const customerItems = items.map((item) => {
    const typeName = btMap[item.breadTypeId].name;
    const sizeName = item.breadSizeId ? sizeMap[item.breadSizeId].name : null;
    return {
      breadTypeName: sizeName ? `${typeName} ${sizeName}` : typeName,
      quantity: item.quantity,
    };
  });

  // Build staff-facing items (with weight when set) — for Telegram
  const staffItems = items.map((item) => {
    const type = btMap[item.breadTypeId];
    const size = item.breadSizeId ? sizeMap[item.breadSizeId] : null;
    const label = size ? `${type.name} ${size.name}` : type.name;
    const withWeight = size?.weightGrams != null ? `${label} (${size.weightGrams}g)` : label;
    return {
      breadTypeName: withWeight,
      quantity: item.quantity,
    };
  });

  await notifyNewOrder(groupId, order.id, {
    customerName: customer.name,
    items: staffItems,
    deliveryDate: resolvedDate,
    notes: notes ?? null,
  });

  // WhatsApp notification to customer — name only, no weight, sent to all phones
  if (notifyCustomer !== false) {
    const phones = await getCustomerPhones(customer.id);
    const itemsSummary = customerItems.map((i) => `${i.quantity} ${i.breadTypeName}`).join(', ');
    await notifyCustomerWhatsApp(phones, 'order_received', [`: ${itemsSummary}`]);
  }

  return jsonResponse({ order, items: itemValues }, 201);
});
