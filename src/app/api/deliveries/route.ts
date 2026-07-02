import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, customers, orderItems, customerPhones } from '@/db/schema';
import { eq, and, inArray, notInArray, asc, sql } from 'drizzle-orm';

// Active deliveries (is_delivery, not yet delivered/cancelled) for owner/manager
// /driver. Returns the navigable address + private notes + the amount to collect.
export const GET = withGroup(async (_request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role !== 'owner' && role !== 'manager' && role !== 'driver') {
    return errorResponse('Forbidden', 403);
  }

  const rows = await db
    .select({
      id: orders.id,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      paid: orders.paid,
      totalOverride: orders.totalOverride,
      deliveryFee: orders.deliveryFee,
      goodsSnapshot: orders.goodsSnapshot,
      customerId: customers.id,
      customerName: customers.name,
      address: customers.address,
      city: customers.city,
      deliveryNotes: customers.deliveryNotes,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(orders.groupId, groupId),
        eq(orders.isDelivery, true),
        notInArray(orders.status, ['delivered', 'cancelled'])
      )
    )
    .orderBy(asc(orders.deliveryDate));

  const ids = rows.map((r) => r.id);

  // Goods subtotal per order
  const sums = ids.length
    ? await db
        .select({
          orderId: orderItems.orderId,
          goods: sql<string>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.pricePerUnit}), 0)`,
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, ids))
        .groupBy(orderItems.orderId)
    : [];
  const goodsByOrder = new Map(sums.map((s) => [s.orderId, Number(s.goods)]));

  // First phone per customer
  const customerIds = Array.from(new Set(rows.map((r) => r.customerId)));
  const phones = customerIds.length
    ? await db
        .select({ customerId: customerPhones.customerId, phone: customerPhones.phone, sortOrder: customerPhones.sortOrder })
        .from(customerPhones)
        .where(inArray(customerPhones.customerId, customerIds))
        .orderBy(asc(customerPhones.sortOrder))
    : [];
  const phoneByCustomer = new Map<number, string>();
  for (const p of phones) if (!phoneByCustomer.has(p.customerId)) phoneByCustomer.set(p.customerId, p.phone);

  const deliveries = rows.map((r) => {
    const goods = r.totalOverride
      ? Number(r.totalOverride)
      : r.goodsSnapshot != null
        ? Number(r.goodsSnapshot)
        : (goodsByOrder.get(r.id) ?? 0);
    const amount = goods + Number(r.deliveryFee || 0);
    return {
      id: r.id,
      deliveryDate: r.deliveryDate,
      status: r.status,
      paid: r.paid,
      amount,
      customerName: r.customerName,
      address: r.address,
      city: r.city,
      deliveryNotes: r.deliveryNotes,
      phone: phoneByCustomer.get(r.customerId) ?? null,
    };
  });

  return jsonResponse({ deliveries });
});
