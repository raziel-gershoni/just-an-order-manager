import { db } from '@/db';
import {
  orderItems,
  orderItemAdditions,
  breadTypes,
  breadSizes,
  breadAdditions,
} from '@/db/schema';
import { eq, inArray, asc } from 'drizzle-orm';
import { formatItemLine } from './order-display';

/**
 * Customer-facing, single-line summary of a persisted order's items —
 * "{qty} {type} {size} (עם ...)" per line, comma-joined, NO weight (weight is
 * staff-only). Built to fill a WhatsApp template body parameter ({{1}}), which
 * Meta rejects if it contains a raw newline — so the join is a comma, never
 * "\n". Reads the same join the delivery/clone paths use, kept in one place.
 */
export async function buildOrderItemsSummary(orderId: number): Promise<string> {
  const itemRows = await db
    .select({
      id: orderItems.id,
      breadTypeName: breadTypes.name,
      sizeName: breadSizes.name,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
    .where(eq(orderItems.orderId, orderId));

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

  return itemRows
    .map((i) => formatItemLine(i.quantity, i.breadTypeName, i.sizeName, additionsByItem[i.id]))
    .join(', ');
}
