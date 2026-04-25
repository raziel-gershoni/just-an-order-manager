import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, breadTypes } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
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

  const items = await db
    .select({
      id: orderItems.id,
      breadTypeId: orderItems.breadTypeId,
      breadTypeName: breadTypes.name,
      quantity: orderItems.quantity,
      pricePerUnit: orderItems.pricePerUnit,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .where(eq(orderItems.orderId, order.id));

  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  const calculatedTotal = items.reduce(
    (s, i) => s + i.quantity * Number(i.pricePerUnit || 0),
    0
  );
  const totalPrice = order.totalOverride ? Number(order.totalOverride) : calculatedTotal;

  return jsonResponse({ order: { ...order, items, totalQuantity, totalPrice, calculatedTotal } });
});

const updateOrderSchema = z.object({
  deliveryType: z.enum(['weekly', 'shabbat', 'specific_date', 'asap']).optional(),
  deliveryDate: z.string().optional(),
  notes: z.string().max(1000).optional(),
  totalOverride: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  isRecurring: z.boolean().optional(),
  items: z.array(z.object({
    breadTypeId: z.number().int().positive(),
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
    const allBreadTypes = await db
      .select()
      .from(breadTypes)
      .where(eq(breadTypes.groupId, groupId));
    const btMap = Object.fromEntries(allBreadTypes.map((bt) => [bt.id, bt]));

    for (const item of parsed.data.items) {
      if (!btMap[item.breadTypeId]) {
        return errorResponse(`Bread type ${item.breadTypeId} not found`, 404);
      }
    }

    // Delete existing items and insert new ones
    await db.delete(orderItems).where(eq(orderItems.orderId, id));

    const itemValues = parsed.data.items.map((item) => ({
      orderId: id,
      breadTypeId: item.breadTypeId,
      quantity: item.quantity,
      pricePerUnit: btMap[item.breadTypeId].price,
    }));
    await db.insert(orderItems).values(itemValues);
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

  const updatedItems = await db
    .select({
      id: orderItems.id,
      breadTypeId: orderItems.breadTypeId,
      breadTypeName: breadTypes.name,
      quantity: orderItems.quantity,
      pricePerUnit: orderItems.pricePerUnit,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .where(eq(orderItems.orderId, id));

  const totalQuantity = updatedItems.reduce((s, i) => s + i.quantity, 0);
  const calculatedTotal = updatedItems.reduce(
    (s, i) => s + i.quantity * Number(i.pricePerUnit || 0),
    0
  );
  const totalPrice = updated.totalOverride ? Number(updated.totalOverride) : calculatedTotal;

  return jsonResponse({ order: { ...updated, items: updatedItems, totalQuantity, totalPrice, calculatedTotal } });
});
