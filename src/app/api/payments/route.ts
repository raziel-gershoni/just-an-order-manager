import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { payments, customers, orders } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod/v4';
import { notifyPrepayment, notifyBalanceAlert } from '@/lib/notifications';
import { BALANCE_DEBT_THRESHOLD } from '@/lib/constants';
import {
  ensureOrderCharge,
  getCustomerBalance,
  settleCoveredOrders,
} from '@/lib/order-payments';

export const GET = withGroup(async (request, _auth, groupId) => {
  const url = new URL(request.url);
  const customerId = url.searchParams.get('customerId');

  const conditions = [eq(payments.groupId, groupId)];
  if (customerId) conditions.push(eq(payments.customerId, Number(customerId)));

  const result = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      type: payments.type,
      orderId: payments.orderId,
      description: payments.description,
      createdAt: payments.createdAt,
      customerId: payments.customerId,
      customerName: customers.name,
    })
    .from(payments)
    .innerJoin(customers, eq(payments.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(payments.createdAt));

  return jsonResponse({ payments: result });
});

const createPaymentSchema = z.object({
  customerId: z.number().int().positive(),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
  type: z.enum(['payment', 'charge', 'adjustment']),
  orderId: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
});

export const POST = withGroup(async (request, _auth, groupId) => {
  const body = await request.json();
  const parsed = createPaymentSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const { customerId, amount, type, orderId, description } = parsed.data;

  // Verify customer belongs to group
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.groupId, groupId)))
    .limit(1);
  if (!customer) return errorResponse('Customer not found', 404);

  // An order id arrives from the client, and everything downstream trusted it:
  // calculateOrderTotal resolves an order by id alone, so a charge could be
  // written on this ledger for the total of an order in another group — or
  // simply the wrong customer's order inside this one. Prove it belongs here
  // before it is used or stored, the way the pay route already does.
  if (orderId != null) {
    const [order] = await db
      .select({ customerId: orders.customerId })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.groupId, groupId)))
      .limit(1);
    if (!order) return errorResponse('Order not found', 404);
    if (order.customerId !== customerId) {
      return errorResponse('Order belongs to a different customer', 400);
    }
  }

  // Auto-create the charge (idempotent) when recording a payment against an
  // order that hasn't been charged yet — one charge source of truth.
  if (type === 'payment' && orderId) {
    await ensureOrderCharge(orderId, groupId, customerId);
  }

  // For charges, amount should be negative
  const finalAmount =
    type === 'charge' && Number(amount) > 0 ? `-${amount}` : amount;

  const [payment] = await db
    .insert(payments)
    .values({
      groupId,
      customerId,
      amount: finalAmount,
      type,
      orderId,
      description,
    })
    .returning();

  // Money on the tab settles the deliveries it covers, whether or not it was
  // filed against one. Without this a customer-level payment leaves its orders
  // flagged unpaid and the daily nudge keeps chasing someone already square.
  if (Number(finalAmount) > 0) {
    await settleCoveredOrders(customerId, groupId);
  }

  // Check balance and notify
  const balanceStr = await getCustomerBalance(customerId, groupId);
  const balance = Number(balanceStr);

  // Notify on payment
  if (type === 'payment' && Number(amount) > 0) {
    await notifyPrepayment(groupId, {
      customerName: customer.name,
      amount,
      balance,
    });
  }

  // Notify on debt threshold
  if (balance < BALANCE_DEBT_THRESHOLD) {
    await notifyBalanceAlert(groupId, {
      customerName: customer.name,
      balance: balanceStr,
    });
  }

  return jsonResponse({ payment, balance: balanceStr }, 201);
});
