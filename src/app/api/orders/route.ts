import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, breadTypes, breadSizes, breadAdditions, orderItemAdditions } from '@/db/schema';
import { eq, and, asc, desc, gte, lte, inArray, notInArray } from 'drizzle-orm';
import { formatItemLine, formatItemLabel, formatStaffItemLabel } from '@/lib/order-display';
import { z } from 'zod/v4';
import { resolveDeliveryDate } from '@/lib/date-utils';
import { notifyNewOrder, notifyCustomerWhatsApp } from '@/lib/notifications';
import { getCustomerPhones } from '@/lib/customer-phones';
import { priceOrderForWrite } from '@/lib/order-pricing';
import { resolveAndPriceOrderLines } from '@/lib/order-lines';

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
      isDelivery: orders.isDelivery,
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
  additionsCharged: z.boolean().nullable().optional(), // null/undefined = inherit order default
});

const createOrderSchema = z.object({
  customerId: z.number().int().positive(),
  deliveryType: z.enum(['weekly', 'shabbat', 'specific_date', 'asap']),
  deliveryDate: z.string().optional(),
  items: z.array(itemSchema).min(1),
  notes: z.string().max(1000).optional(),
  totalOverride: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  isDelivery: z.boolean().optional(),
  deliveryFee: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  isRecurring: z.boolean().optional(),
  dealsEnabled: z.boolean().optional(),
  additionsCharged: z.boolean().optional(),
  notifyCustomer: z.boolean().optional(),
});

export const POST = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role === 'driver') return errorResponse('Forbidden', 403);

  const body = await request.json();
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const { customerId, deliveryType, deliveryDate, items, notes, totalOverride, isDelivery, deliveryFee, isRecurring, dealsEnabled, additionsCharged, notifyCustomer } = parsed.data;
  const chargeAdd = additionsCharged ?? true;

  // Verify customer
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.groupId, groupId)))
    .limit(1);
  if (!customer) return errorResponse('Customer not found', 404);

  // Resolve + validate + price every line through the shared write-path helper.
  const priced = await resolveAndPriceOrderLines(groupId, items, chargeAdd);
  if (!priced.ok) return errorResponse(priced.error, priced.status);
  const engineLines = priced.lines.map((l) => l.writeLine);

  // Compute the bulk-priced goods total + breakdown to freeze onto the order.
  const dealsOn = dealsEnabled ?? true;
  const effectiveFee = isDelivery && deliveryFee ? Number(deliveryFee) : 0;
  const pricing = await priceOrderForWrite(groupId, engineLines, {
    dealsEnabled: dealsOn,
    deliveryFee: effectiveFee,
    totalOverride: totalOverride ? Number(totalOverride) : null,
    surcharge: priced.surcharge,
  });

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
      isDelivery: isDelivery ?? false,
      deliveryFee: (isDelivery && deliveryFee) ? deliveryFee : '0',
      isRecurring: isRecurring ?? false,
      dealsEnabled: dealsOn,
      additionsCharged: chargeAdd,
      goodsSnapshot: pricing.goods.toFixed(2),
      pricingBreakdown: pricing.rows,
    })
    .returning();

  // Insert the items now that we have the order id (lines stay in input order).
  const insertedItems = await db
    .insert(orderItems)
    .values(
      priced.lines.map((l) => ({
        orderId: order.id,
        breadTypeId: l.breadTypeId,
        breadSizeId: l.breadSizeId,
        quantity: l.quantity,
        pricePerUnit: l.pricePerUnit,
        additionsCharged: l.additionsCharged,
      }))
    )
    .returning();

  // Persist additions per inserted item
  const additionInserts: { orderItemId: number; breadAdditionId: number }[] = [];
  for (let i = 0; i < priced.lines.length; i++) {
    for (const aid of priced.lines[i].breadAdditionIds) {
      additionInserts.push({ orderItemId: insertedItems[i].id, breadAdditionId: aid });
    }
  }
  if (additionInserts.length > 0) {
    await db.insert(orderItemAdditions).values(additionInserts);
  }

  // Notification labels are built straight from the resolved lines — no re-fetch,
  // one shared formatter. Staff = with weight (baker); customer = name only.
  const staffItems = priced.lines.map((l) => ({
    breadTypeName: formatStaffItemLabel(l.breadTypeName, l.breadSizeName, l.weightGrams, l.additionNames),
    quantity: l.quantity,
  }));

  await notifyNewOrder(groupId, order.id, {
    customerName: customer.name,
    items: staffItems,
    deliveryDate: resolvedDate,
    notes: notes ?? null,
  });

  // WhatsApp notification to customer — name only, no weight, sent to all phones
  if (notifyCustomer !== false) {
    const phones = await getCustomerPhones(customer.id);
    const itemsSummary = priced.lines
      .map((l) => `${l.quantity} ${formatItemLabel(l.breadTypeName, l.breadSizeName, l.additionNames)}`)
      .join(', ');
    await notifyCustomerWhatsApp(phones, 'order_received', [`: ${itemsSummary}`]);
  }

  return jsonResponse({ order, items: insertedItems }, 201);
});
