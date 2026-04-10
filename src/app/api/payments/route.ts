import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { payments, customers, orders, orderItems, breadTypes } from '@/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { notifyPrepayment, notifyBalanceAlert } from '@/lib/notifications';
import { BALANCE_DEBT_THRESHOLD } from '@/lib/constants';

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

  // Auto-create charge if recording a payment for an order without an existing charge
  if (type === 'payment' && orderId) {
    const [existingCharge] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.orderId, orderId),
          eq(payments.type, 'charge'),
          eq(payments.groupId, groupId)
        )
      )
      .limit(1);

    if (!existingCharge) {
      // Calculate order total for the charge
      const items = await db
        .select({
          quantity: orderItems.quantity,
          pricePerUnit: orderItems.pricePerUnit,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));

      const orderTotal = items.reduce(
        (s, i) => s + i.quantity * Number(i.pricePerUnit || 0),
        0
      );

      if (orderTotal > 0) {
        await db.insert(payments).values({
          groupId,
          customerId,
          amount: `-${orderTotal.toFixed(2)}`,
          type: 'charge',
          orderId,
        });
      }
    }
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

  // Check balance and notify
  const [balanceResult] = await db
    .select({
      balance: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
    })
    .from(payments)
    .where(
      and(eq(payments.customerId, customerId), eq(payments.groupId, groupId))
    );

  const balance = Number(balanceResult.balance);

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
      balance: balanceResult.balance,
    });
  }

  return jsonResponse({ payment, balance: balanceResult.balance }, 201);
});
