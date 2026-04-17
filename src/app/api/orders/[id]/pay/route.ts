import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, payments, customers } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { notifyPrepayment } from '@/lib/notifications';

function getOrderId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  // /api/orders/[id]/pay → id is at index -2
  return Number(parts.at(-2));
}

const paySchema = z.object({
  action: z.enum(['paid', 'credit', 'unpaid', 'mark_paid']),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

export const POST = withGroup(async (request, _auth, groupId) => {
  const id = getOrderId(request.url);

  const body = await request.json();
  const parsed = paySchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  // Verify order and get customer name
  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      customerId: orders.customerId,
      customerName: customers.name,
      totalOverride: orders.totalOverride,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(and(eq(orders.id, id), eq(orders.groupId, groupId)))
    .limit(1);

  if (!order) return errorResponse('Order not found', 404);
  if (order.status !== 'delivered') return errorResponse('Order must be delivered', 400);

  const { action, amount } = parsed.data;

  // "mark_paid" just flips the paid flag, no financial records
  if (action === 'mark_paid') {
    await db.update(orders).set({ paid: true, updatedAt: new Date() }).where(eq(orders.id, id));
    const [balanceResult] = await db
      .select({ balance: sql<string>`COALESCE(SUM(${payments.amount}), 0)` })
      .from(payments)
      .where(and(eq(payments.customerId, order.customerId), eq(payments.groupId, groupId)));
    return jsonResponse({ balance: balanceResult.balance, paid: true });
  }

  // Calculate order total
  const items = await db
    .select({
      quantity: orderItems.quantity,
      pricePerUnit: orderItems.pricePerUnit,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, id));

  const calculatedTotal = items.reduce(
    (s, i) => s + i.quantity * Number(i.pricePerUnit || 0),
    0
  );
  const orderTotal = order.totalOverride ? Number(order.totalOverride) : calculatedTotal;

  // Check if charge already exists for this order
  const [existingCharge] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.orderId, id),
        eq(payments.type, 'charge'),
        eq(payments.groupId, groupId)
      )
    )
    .limit(1);

  // Create charge if not already recorded
  if (!existingCharge && orderTotal > 0) {
    await db.insert(payments).values({
      groupId,
      customerId: order.customerId,
      amount: `-${orderTotal.toFixed(2)}`,
      type: 'charge',
      orderId: id,
    });
  }

  // Create payment if customer paid (skip if payment already exists for this order)
  if (action === 'paid' && amount) {
    const [existingPayment] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.orderId, id),
          eq(payments.type, 'payment'),
          eq(payments.groupId, groupId)
        )
      )
      .limit(1);

    if (!existingPayment) {
      await db.insert(payments).values({
        groupId,
        customerId: order.customerId,
        amount,
        type: 'payment',
        orderId: id,
      });
    }
  }

  // Set paid flag: true for 'paid' and 'credit', false for 'unpaid'
  const isPaid = action !== 'unpaid';
  await db.update(orders).set({ paid: isPaid, updatedAt: new Date() }).where(eq(orders.id, id));

  // Get updated balance
  const [balanceResult] = await db
    .select({
      balance: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.customerId, order.customerId),
        eq(payments.groupId, groupId)
      )
    );

  const balance = Number(balanceResult.balance);

  // Notify on payment
  if (action === 'paid' && amount) {
    await notifyPrepayment(groupId, {
      customerName: order.customerName,
      amount,
      balance,
    });
  }

  return jsonResponse({ balance: balanceResult.balance, paid: isPaid });
});
