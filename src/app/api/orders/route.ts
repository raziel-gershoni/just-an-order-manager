import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, breadTypes, breadSizes, breadTypeSizes, breadAdditions, breadTypeAdditions, orderItemAdditions } from '@/db/schema';
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
  type ItemRow = { id: number; orderId: number; breadTypeName: string; sizeName: string | null; quantity: number; pricePerUnit: string | null; additions: string[] };
  const itemsMap: Record<number, ItemRow[]> = {};

  if (orderIds.length > 0) {
    const allItems = await db
      .select({
        id: orderItems.id,
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

    // Fetch additions for these item ids; group by orderItemId
    const itemIds = allItems.map((i) => i.id);
    const additionLinks = itemIds.length
      ? await db
          .select({
            orderItemId: orderItemAdditions.orderItemId,
            name: breadAdditions.name,
            sortOrder: breadAdditions.sortOrder,
          })
          .from(orderItemAdditions)
          .innerJoin(breadAdditions, eq(orderItemAdditions.breadAdditionId, breadAdditions.id))
          .where(inArray(orderItemAdditions.orderItemId, itemIds))
          .orderBy(asc(breadAdditions.sortOrder))
      : [];

    const additionsByItem: Record<number, string[]> = {};
    for (const a of additionLinks) {
      if (!additionsByItem[a.orderItemId]) additionsByItem[a.orderItemId] = [];
      additionsByItem[a.orderItemId].push(a.name);
    }

    for (const item of allItems) {
      if (!itemsMap[item.orderId]) itemsMap[item.orderId] = [];
      itemsMap[item.orderId].push({
        id: item.id,
        orderId: item.orderId,
        breadTypeName: item.breadTypeName,
        sizeName: item.sizeName,
        quantity: item.quantity,
        pricePerUnit: item.pricePerUnit,
        additions: additionsByItem[item.id] ?? [],
      });
    }
  }

  const result = orderRows.map((o) => {
    const items = itemsMap[o.id] || [];
    return {
      ...o,
      items,
      totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
      itemsSummary: items.map((i) => formatItemLine(i.quantity, i.breadTypeName, i.sizeName, i.additions)).join(', '),
    };
  });

  return jsonResponse({ orders: result });
});

const itemSchema = z.object({
  breadTypeId: z.number().int().positive(),
  breadSizeId: z.number().int().positive(),
  breadAdditionIds: z.array(z.number().int().positive()).optional(),
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

  // Validate additions per item: must belong to the group AND be enabled on the type
  const allAdditionIds = items.flatMap((i) => i.breadAdditionIds ?? []);
  const additionRows = allAdditionIds.length
    ? await db
        .select()
        .from(breadAdditions)
        .where(and(inArray(breadAdditions.id, allAdditionIds), eq(breadAdditions.groupId, groupId)))
    : [];
  const additionMap = new Map(additionRows.map((a) => [a.id, a]));

  const additionTypeLinks = allAdditionIds.length
    ? await db
        .select()
        .from(breadTypeAdditions)
        .where(
          and(
            inArray(breadTypeAdditions.breadTypeId, typeIds),
            inArray(breadTypeAdditions.breadAdditionId, allAdditionIds)
          )
        )
    : [];
  const additionLinkSet = new Set(
    additionTypeLinks.map((l) => `${l.breadTypeId}:${l.breadAdditionId}`)
  );

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
    for (const addId of item.breadAdditionIds ?? []) {
      if (!additionMap.has(addId)) {
        return errorResponse(`Bread addition ${addId} not found`, 404);
      }
      if (!additionLinkSet.has(`${item.breadTypeId}:${addId}`)) {
        return errorResponse(
          `Addition ${addId} not enabled for type ${item.breadTypeId}`,
          400
        );
      }
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

  const insertedItems = await db.insert(orderItems).values(itemValues).returning();

  // Persist additions per inserted item
  const additionInserts: { orderItemId: number; breadAdditionId: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const ids = items[i].breadAdditionIds ?? [];
    for (const aid of ids) {
      additionInserts.push({ orderItemId: insertedItems[i].id, breadAdditionId: aid });
    }
  }
  if (additionInserts.length > 0) {
    await db.insert(orderItemAdditions).values(additionInserts);
  }

  // Build customer-facing items (name + size + additions, no weight) — for WhatsApp
  const customerItems = items.map((item) => {
    const typeName = btMap[item.breadTypeId].name;
    const sizeName = sizeMap[item.breadSizeId].name;
    const adds = (item.breadAdditionIds ?? []).map((id) => additionMap.get(id)?.name).filter(Boolean) as string[];
    return {
      breadTypeName: formatItemLine(1, typeName, sizeName, adds).slice(2),
      quantity: item.quantity,
    };
  });

  // Build staff-facing items (with weight + additions) — for Telegram
  const staffItems = items.map((item) => {
    const type = btMap[item.breadTypeId];
    const size = sizeMap[item.breadSizeId];
    let label = `${type.name} ${size.name}`;
    if (size.weightGrams != null) label = `${label} (${size.weightGrams}g)`;
    const adds = (item.breadAdditionIds ?? []).map((id) => additionMap.get(id)?.name).filter(Boolean) as string[];
    if (adds.length) label = `${label} (עם ${adds.join(', ')})`;
    return {
      breadTypeName: label,
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
