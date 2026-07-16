import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, customers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';
import { recordOrderPayment } from '@/lib/order-payments';

function getOrderId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  // /api/orders/[id]/pay → id is at index -2
  return Number(parts.at(-2));
}

const paySchema = z.object({
  action: z.enum(['paid', 'credit', 'unpaid', 'mark_paid']),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

export const POST = withGroup(async (request, auth, groupId) => {
  const id = getOrderId(request.url);
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;

  const body = await request.json();
  const parsed = paySchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      isDelivery: orders.isDelivery,
      customerId: orders.customerId,
      customerName: customers.name,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(and(eq(orders.id, id), eq(orders.groupId, groupId)))
    .limit(1);

  if (!order) return errorResponse('Order not found', 404);

  // Drivers may only collect on delivery orders.
  if (role === 'driver' && !order.isDelivery) return errorResponse('Forbidden', 403);
  if (order.status !== 'delivered') return errorResponse('Order must be delivered', 400);

  const { action, amount } = parsed.data;
  const result = await recordOrderPayment(
    { id: order.id, groupId, customerId: order.customerId, customerName: order.customerName },
    action,
    amount
  );
  return jsonResponse({ balance: result.balance, paid: result.paid });
});
