import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, customers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';
import { cancelPrepayment, recordPrepayment } from '@/lib/order-payments';

function getOrderId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  const idx = parts.indexOf('orders');
  return Number(parts[idx + 1]);
}

const prepaySchema = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine((v) => Number(v) > 0),
});

async function findOpenOrder(orderId: number, groupId: number) {
  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      customerId: orders.customerId,
      customerName: customers.name,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(and(eq(orders.id, orderId), eq(orders.groupId, groupId)))
    .limit(1);
  if (!order) return { error: errorResponse('Order not found', 404) };
  // Delivered: its payment belongs on the order's pay card, after the charge.
  if (order.status === 'delivered' || order.status === 'cancelled') {
    return { error: errorResponse('Order is no longer open', 409) };
  }
  return { order };
}

// Paid before delivery: record it against the order. Drivers collect at the
// door through the pay route; they don't book money ahead.
export const POST = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role === 'driver') return errorResponse('Forbidden', 403);

  const parsed = prepaySchema.safeParse(await request.json());
  if (!parsed.success) return errorResponse(parsed.error.message);

  const found = await findOpenOrder(getOrderId(request.url), groupId);
  if (found.error) return found.error;
  const { order } = found;

  const result = await recordPrepayment(
    { id: order.id, groupId, customerId: order.customerId, customerName: order.customerName },
    parsed.data.amount
  );
  return jsonResponse(result);
});

// Undo a payment in advance recorded by mistake.
export const DELETE = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role === 'driver') return errorResponse('Forbidden', 403);

  const found = await findOpenOrder(getOrderId(request.url), groupId);
  if (found.error) return found.error;

  const result = await cancelPrepayment({ id: found.order.id, groupId });
  if (!result) return errorResponse('Order is no longer open', 409);
  return jsonResponse({ ...result, paid: false, paidAmount: 0 });
});
