import { db } from '@/db';
import {
  orders,
  orderItems,
  customers,
  breadTypes,
  breadSizes,
  breadAdditions,
  orderItemAdditions,
} from '@/db/schema';
import { eq, inArray, asc } from 'drizzle-orm';
import { formatItemLineForStaff } from './order-display';

/**
 * Who an order is for and what is in it, as the staff's Telegram messages about
 * it show (ready, delivered). Null when the order or its customer is gone.
 */
export async function orderStaffSummary(
  orderId: number
): Promise<{ customerName: string; itemsSummary: string } | null> {
  const [customer] = await db
    .select({ name: customers.name })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!customer) return null;

  const itemRows = await db
    .select({
      id: orderItems.id,
      breadTypeName: breadTypes.name,
      sizeName: breadSizes.name,
      weightGrams: breadSizes.weightGrams,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.id));

  const itemIds = itemRows.map((i) => i.id);
  const additionLinks = itemIds.length
    ? await db
        .select({ orderItemId: orderItemAdditions.orderItemId, name: breadAdditions.name })
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

  return {
    customerName: customer.name,
    itemsSummary: itemRows
      .map((i) => formatItemLineForStaff(i.quantity, i.breadTypeName, i.sizeName, i.weightGrams, additionsByItem[i.id]))
      .join(', '),
  };
}
