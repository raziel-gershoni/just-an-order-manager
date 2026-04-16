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
  paid: z.boolean(),
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

  // Create payment if customer paid
  if (parsed.data.paid && parsed.data.amount) {
    await db.insert(payments).values({
      groupId,
      customerId: order.customerId,
      amount: parsed.data.amount,
      type: 'payment',
      orderId: id,
    });
  }

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
  if (parsed.data.paid && parsed.data.amount) {
    await notifyPrepayment(groupId, {
      customerName: order.customerName,
      amount: parsed.data.amount,
      balance,
    });
  }

  return jsonResponse({ balance: balanceResult.balance });
});
