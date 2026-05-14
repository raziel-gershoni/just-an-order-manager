import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, customerPhones, breadTypes, breadSizes, breadTypeSizes, breadAdditions, breadTypeAdditions, orderItemAdditions } from '@/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { resolveDeliveryDate } from '@/lib/date-utils';

function getOrderId(url: string): number {
  return Number(new URL(url).pathname.split('/').at(-1));
}

export const GET = withGroup(async (request, _auth, groupId) => {
  const id = getOrderId(request.url);

  const [order] = await db
    .select({
      id: orders.id,
      deliveryType: orders.deliveryType,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      notes: orders.notes,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      customerName: customers.name,
      customerId: customers.id,
      totalOverride: orders.totalOverride,
      paid: orders.paid,
      isRecurring: orders.isRecurring,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(and(eq(orders.id, id), eq(orders.groupId, groupId)))
    .limit(1);

  if (!order) return errorResponse('Order not found', 404);

  const itemRows = await db
    .select({
      id: orderItems.id,
      breadTypeId: orderItems.breadTypeId,
      breadTypeName: breadTypes.name,
      breadSizeId: orderItems.breadSizeId,
      sizeName: breadSizes.name,
      quantity: orderItems.quantity,
      pricePerUnit: orderItems.pricePerUnit,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
    .where(eq(orderItems.orderId, order.id));

  // Fetch additions per item
  const itemIds = itemRows.map((i) => i.id);
  const additionLinks = itemIds.length
    ? await db
        .select({
          orderItemId: orderItemAdditions.orderItemId,
          breadAdditionId: breadAdditions.id,
          name: breadAdditions.name,
          sortOrder: breadAdditions.sortOrder,
        })
        .from(orderItemAdditions)
        .innerJoin(breadAdditions, eq(orderItemAdditions.breadAdditionId, breadAdditions.id))
        .where(inArray(orderItemAdditions.orderItemId, itemIds))
    : [];

  const additionsByItem: Record<number, { id: number; name: string }[]> = {};
  for (const a of additionLinks) {
    if (!additionsByItem[a.orderItemId]) additionsByItem[a.orderItemId] = [];
    additionsByItem[a.orderItemId].push({ id: a.breadAdditionId, name: a.name });
  }

  const items = itemRows.map((i) => ({
    ...i,
    additions: additionsByItem[i.id] ?? [],
  }));

  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  const calculatedTotal = items.reduce(
    (s, i) => s + i.quantity * Number(i.pricePerUnit || 0),
    0
  );
  const totalPrice = order.totalOverride ? Number(order.totalOverride) : calculatedTotal;

  // Count of customer phones — used by the order UI to decide whether to
  // show the "notify customer" checkbox on status changes.
  const [{ phoneCount }] = await db
    .select({ phoneCount: sql<number>`COUNT(*)::int` })
    .from(customerPhones)
    .where(eq(customerPhones.customerId, order.customerId));

  return jsonResponse({
    order: { ...order, items, totalQuantity, totalPrice, calculatedTotal, customerPhoneCount: phoneCount },
  });
});

const updateOrderSchema = z.object({
  deliveryType: z.enum(['weekly', 'shabbat', 'specific_date', 'asap']).optional(),
  deliveryDate: z.string().optional(),
  notes: z.string().max(1000).optional(),
  totalOverride: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  isRecurring: z.boolean().optional(),
  items: z.array(z.object({
    breadTypeId: z.number().int().positive(),
    breadSizeId: z.number().int().positive(),
    breadAdditionIds: z.array(z.number().int().positive()).optional(),
    quantity: z.number().int().positive(),
  })).min(1).optional(),
});

export const PATCH = withGroup(async (request, _auth, groupId) => {
  const id = getOrderId(request.url);

  const body = await request.json();
  const parsed = updateOrderSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  // Fetch existing order
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.groupId, groupId)))
    .limit(1);

  if (!order) return errorResponse('Order not found', 404);
  if (order.status === 'delivered' || order.status === 'cancelled') {
    return errorResponse('Cannot edit completed or cancelled orders', 400);
  }

  // Build update data
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (parsed.data.deliveryType) {
    updateData.deliveryType = parsed.data.deliveryType;
    updateData.deliveryDate = resolveDeliveryDate(
      parsed.data.deliveryType,
      parsed.data.deliveryDate
    );
  } else if (parsed.data.deliveryDate !== undefined) {
    updateData.deliveryDate = parsed.data.deliveryDate || null;
  }

  if (parsed.data.notes !== undefined) {
    updateData.notes = parsed.data.notes || null;
  }

  if (parsed.data.totalOverride !== undefined) {
    updateData.totalOverride = parsed.data.totalOverride;
  }

  if (parsed.data.isRecurring !== undefined) {
    updateData.isRecurring = parsed.data.isRecurring;
  }

  // Update order fields
  await db
    .update(orders)
    .set(updateData)
    .where(eq(orders.id, id));

  // Update items if provided
  if (parsed.data.items) {
    const validTypes = await db
      .select({ id: breadTypes.id })
      .from(breadTypes)
      .where(eq(breadTypes.groupId, groupId));
    const validTypeIds = new Set(validTypes.map((t) => t.id));

    const sizeIds = parsed.data.items.map((i) => i.breadSizeId);
    const sizesInGroup = await db
      .select()
      .from(breadSizes)
      .where(and(inArray(breadSizes.id, sizeIds), eq(breadSizes.groupId, groupId)));
    const sizeMap = Object.fromEntries(sizesInGroup.map((s) => [s.id, s]));

    const typeIds = parsed.data.items.map((i) => i.breadTypeId);
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

    // Validate additions per item
    const allAdditionIds = parsed.data.items.flatMap((i) => i.breadAdditionIds ?? []);
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
    for (const item of parsed.data.items) {
      if (!validTypeIds.has(item.breadTypeId)) {
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
      for (const aid of item.breadAdditionIds ?? []) {
        if (!additionMap.has(aid)) {
          return errorResponse(`Bread addition ${aid} not found`, 404);
        }
        if (!additionLinkSet.has(`${item.breadTypeId}:${aid}`)) {
          return errorResponse(
            `Addition ${aid} not enabled for type ${item.breadTypeId}`,
            400
          );
        }
      }
      itemValues.push({
        orderId: id,
        breadTypeId: item.breadTypeId,
        breadSizeId: item.breadSizeId,
        quantity: item.quantity,
        pricePerUnit: link.priceOverride ?? size.price,
      });
    }

    // Clear old item->addition junction rows first (FK to order_items would block delete)
    const oldItems = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.orderId, id));
    if (oldItems.length > 0) {
      await db.delete(orderItemAdditions).where(
        inArray(orderItemAdditions.orderItemId, oldItems.map((i) => i.id))
      );
    }
    await db.delete(orderItems).where(eq(orderItems.orderId, id));
    const insertedItems = await db.insert(orderItems).values(itemValues).returning();

    // Persist new additions per inserted item
    const additionInserts: { orderItemId: number; breadAdditionId: number }[] = [];
    for (let i = 0; i < parsed.data.items.length; i++) {
      const ids = parsed.data.items[i].breadAdditionIds ?? [];
      for (const aid of ids) {
        additionInserts.push({ orderItemId: insertedItems[i].id, breadAdditionId: aid });
      }
    }
    if (additionInserts.length > 0) {
      await db.insert(orderItemAdditions).values(additionInserts);
    }
  }

  // Return full order with items (matching GET format)
  const [updated] = await db
    .select({
      id: orders.id,
      deliveryType: orders.deliveryType,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      notes: orders.notes,
      totalOverride: orders.totalOverride,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      customerName: customers.name,
      customerId: customers.id,
      paid: orders.paid,
      isRecurring: orders.isRecurring,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(eq(orders.id, id))
    .limit(1);

  const updatedItemRows = await db
    .select({
      id: orderItems.id,
      breadTypeId: orderItems.breadTypeId,
      breadTypeName: breadTypes.name,
      breadSizeId: orderItems.breadSizeId,
      sizeName: breadSizes.name,
      quantity: orderItems.quantity,
      pricePerUnit: orderItems.pricePerUnit,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
    .where(eq(orderItems.orderId, id));

  const updatedItemIds = updatedItemRows.map((i) => i.id);
  const updatedAdditionLinks = updatedItemIds.length
    ? await db
        .select({
          orderItemId: orderItemAdditions.orderItemId,
          breadAdditionId: breadAdditions.id,
          name: breadAdditions.name,
        })
        .from(orderItemAdditions)
        .innerJoin(breadAdditions, eq(orderItemAdditions.breadAdditionId, breadAdditions.id))
        .where(inArray(orderItemAdditions.orderItemId, updatedItemIds))
    : [];
  const updatedAdditionsByItem: Record<number, { id: number; name: string }[]> = {};
  for (const a of updatedAdditionLinks) {
    if (!updatedAdditionsByItem[a.orderItemId]) updatedAdditionsByItem[a.orderItemId] = [];
    updatedAdditionsByItem[a.orderItemId].push({ id: a.breadAdditionId, name: a.name });
  }

  const updatedItems = updatedItemRows.map((i) => ({
    ...i,
    additions: updatedAdditionsByItem[i.id] ?? [],
  }));

  const totalQuantity = updatedItems.reduce((s, i) => s + i.quantity, 0);
  const calculatedTotal = updatedItems.reduce(
    (s, i) => s + i.quantity * Number(i.pricePerUnit || 0),
    0
  );
  const totalPrice = updated.totalOverride ? Number(updated.totalOverride) : calculatedTotal;

  return jsonResponse({ order: { ...updated, items: updatedItems, totalQuantity, totalPrice, calculatedTotal } });
});
