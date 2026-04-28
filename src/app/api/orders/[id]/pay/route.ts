import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, customers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';
import { notifyPrepayment } from '@/lib/notifications';
import {
  ensureOrderCharge,
  ensureOrderPayment,
  getCustomerBalance,
} from '@/lib/order-payments';

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

  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      customerId: orders.customerId,
      customerName: customers.name,
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
    const balance = await getCustomerBalance(order.customerId, groupId);
    return jsonResponse({ balance, paid: true });
  }

  // Record the charge if it's not already there
  await ensureOrderCharge(id, groupId, order.customerId);

  // Record the payment if customer paid
  if (action === 'paid' && amount) {
    await ensureOrderPayment(id, groupId, order.customerId, amount);
  }

  // paid flag: true for 'paid' and 'credit', false for 'unpaid'
  const isPaid = action !== 'unpaid';
  await db.update(orders).set({ paid: isPaid, updatedAt: new Date() }).where(eq(orders.id, id));

  const balance = await getCustomerBalance(order.customerId, groupId);

  // Notify on payment
  if (action === 'paid' && amount) {
    await notifyPrepayment(groupId, {
      customerName: order.customerName,
      amount,
      balance: Number(balance),
    });
  }

  return jsonResponse({ balance, paid: isPaid });
});
