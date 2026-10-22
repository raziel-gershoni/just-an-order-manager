import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, customers, orderItems, customerPhones } from '@/db/schema';
import { eq, and, inArray, notInArray, asc, sql } from 'drizzle-orm';
import { orderTotalFromGoods } from '@/lib/order-pricing';
import { orderPaymentsTotals } from '@/lib/order-payments';
import { normalizePhoneNumber } from '@/lib/phone-links';

// Active deliveries (is_delivery, not yet delivered/cancelled) for owner/manager
// /driver. Returns the navigable address + private notes + the amount to collect
// (the total less anything paid in advance).
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
  // Paid partly in advance: the driver collects the rest, not the total.
  const paidByOrder = await orderPaymentsTotals(groupId, ids);

  // One phone per customer: the first one a chat can actually open (on WhatsApp
  // and with a wa.me form), since the driver's button opens a chat; failing
  // that the first number at all, so its digits are still on the screen.
  const customerIds = Array.from(new Set(rows.map((r) => r.customerId)));
  const phones = customerIds.length
    ? await db
        .select({
          customerId: customerPhones.customerId,
          phone: customerPhones.phone,
          sortOrder: customerPhones.sortOrder,
          hasWhatsapp: customerPhones.hasWhatsapp,
        })
        .from(customerPhones)
        .where(inArray(customerPhones.customerId, customerIds))
        .orderBy(asc(customerPhones.sortOrder))
    : [];
  const chatable = (p: { phone: string; hasWhatsapp: boolean }) =>
    p.hasWhatsapp && normalizePhoneNumber(p.phone) !== null;
  const phoneByCustomer = new Map<number, { phone: string; hasWhatsapp: boolean }>();
  for (const p of phones) {
    const seen = phoneByCustomer.get(p.customerId);
    if (!seen || (!chatable(seen) && chatable(p))) {
      phoneByCustomer.set(p.customerId, { phone: p.phone, hasWhatsapp: p.hasWhatsapp });
    }
  }

  const deliveries = rows.map((r) => {
    const goods = r.goodsSnapshot != null ? Number(r.goodsSnapshot) : (goodsByOrder.get(r.id) ?? 0);
    const total = orderTotalFromGoods(r, goods);
    const amount = Math.max(0, Math.round((total - (paidByOrder.get(r.id) ?? 0)) * 100) / 100);
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
      phone: phoneByCustomer.get(r.customerId)?.phone ?? null,
      phoneHasWhatsapp: phoneByCustomer.get(r.customerId)?.hasWhatsapp ?? false,
    };
  });

  return jsonResponse({ deliveries });
});
