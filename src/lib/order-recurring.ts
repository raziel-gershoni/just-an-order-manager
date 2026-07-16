import { db } from '@/db';
import {
  orders,
  orderItems,
  orderItemAdditions,
  customers,
  breadTypes,
  breadSizes,
  breadAdditions,
} from '@/db/schema';
import { eq, inArray, asc } from 'drizzle-orm';
import { nextRecurringDate } from './date-utils';
import { notifyNewOrder } from './notifications';
import { formatStaffItemLabel } from './order-display';

type SourceOrder = typeof orders.$inferSelect;

/**
 * Auto-create the next occurrence of a delivered recurring order, and give the
 * baker the same "new order" heads-up a manual order sends. Shared by every
 * delivery surface (web PATCH + Telegram inline button) so recurrence behaves
 * identically no matter who marks the order delivered.
 *
 * Fully best-effort: the delivery + charge are already committed by the caller,
 * so nothing here throws. neon-http has no interactive transactions, so a
 * partial clone is unwound by hand in the catch, and the notification lives in
 * its own block so a notify failure can't delete a good clone.
 *
 * Returns the new order id on full success, else null.
 */
export async function createNextRecurringOrder(order: SourceOrder): Promise<number | null> {
  let createdOrderId: number | null = null;
  let nextDeliveryDate: string | null = null;

  try {
    const items = await db
      .select({
        id: orderItems.id,
        breadTypeId: orderItems.breadTypeId,
        breadSizeId: orderItems.breadSizeId,
        quantity: orderItems.quantity,
        pricePerUnit: orderItems.pricePerUnit,
        additionsCharged: orderItems.additionsCharged,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));

    if (items.length === 0) return null;

    // Fetch additions to copy along, keyed by old item id
    const oldItemIds = items.map((i) => i.id);
    const additionLinks = await db
      .select()
      .from(orderItemAdditions)
      .where(inArray(orderItemAdditions.orderItemId, oldItemIds));
    const additionsByOldItem: Record<number, number[]> = {};
    for (const a of additionLinks) {
      if (!additionsByOldItem[a.orderItemId]) additionsByOldItem[a.orderItemId] = [];
      additionsByOldItem[a.orderItemId].push(a.breadAdditionId);
    }

    // Weekly cadence: advance this order's own delivery date by 7 days.
    nextDeliveryDate = nextRecurringDate(order.deliveryType, order.deliveryDate);
    const [nextOrder] = await db
      .insert(orders)
      .values({
        groupId: order.groupId,
        customerId: order.customerId,
        deliveryType: order.deliveryType,
        deliveryDate: nextDeliveryDate,
        notes: order.notes,
        totalOverride: order.totalOverride,
        isRecurring: true,
        // Carry delivery status + fee so a recurring delivery order doesn't
        // silently regenerate as a fee-less pickup.
        isDelivery: order.isDelivery,
        deliveryFee: order.deliveryFee,
        // Items are copied verbatim, so the frozen pricing carries over too.
        dealsEnabled: order.dealsEnabled,
        additionsCharged: order.additionsCharged,
        goodsSnapshot: order.goodsSnapshot,
        pricingBreakdown: order.pricingBreakdown,
      })
      .returning();
    createdOrderId = nextOrder.id;

    const newItems = await db
      .insert(orderItems)
      .values(
        items.map((i) => ({
          orderId: nextOrder.id,
          breadTypeId: i.breadTypeId,
          breadSizeId: i.breadSizeId,
          quantity: i.quantity,
          pricePerUnit: i.pricePerUnit,
          additionsCharged: i.additionsCharged,
        }))
      )
      .returning();

    // Copy each item's additions onto the new item rows in the same order
    const newAdditionRows: { orderItemId: number; breadAdditionId: number }[] = [];
    for (let i = 0; i < items.length; i++) {
      const newItemId = newItems[i].id;
      for (const aid of additionsByOldItem[items[i].id] ?? []) {
        newAdditionRows.push({ orderItemId: newItemId, breadAdditionId: aid });
      }
    }
    if (newAdditionRows.length > 0) {
      await db.insert(orderItemAdditions).values(newAdditionRows);
    }
  } catch (err) {
    console.error(`Failed to create next recurring order after delivering order ${order.id}:`, err);
    // Unwind a half-inserted clone (a committed order row with no items would
    // otherwise surface in lists as a phantom priced order). Reverse-FK order.
    if (createdOrderId != null) {
      try {
        const orphanItems = await db
          .select({ id: orderItems.id })
          .from(orderItems)
          .where(eq(orderItems.orderId, createdOrderId));
        if (orphanItems.length > 0) {
          await db
            .delete(orderItemAdditions)
            .where(inArray(orderItemAdditions.orderItemId, orphanItems.map((i) => i.id)));
          await db.delete(orderItems).where(eq(orderItems.orderId, createdOrderId));
        }
        await db.delete(orders).where(eq(orders.id, createdOrderId));
      } catch (cleanupErr) {
        console.error(`Failed to clean up partial recurring clone ${createdOrderId}:`, cleanupErr);
      }
    }
    return null;
  }

  // Baker heads-up — same rich staff labels (type, size, weight, additions) as a
  // manual order. Separate best-effort block so a notify failure can't delete a
  // good clone.
  try {
    const [cust] = await db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, order.customerId))
      .limit(1);

    const notifyRows = await db
      .select({
        itemId: orderItems.id,
        typeName: breadTypes.name,
        sizeName: breadSizes.name,
        weightGrams: breadSizes.weightGrams,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
      .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
      .where(eq(orderItems.orderId, createdOrderId));

    const notifyItemIds = notifyRows.map((r) => r.itemId);
    const addRows = notifyItemIds.length
      ? await db
          .select({ orderItemId: orderItemAdditions.orderItemId, name: breadAdditions.name })
          .from(orderItemAdditions)
          .innerJoin(breadAdditions, eq(orderItemAdditions.breadAdditionId, breadAdditions.id))
          .where(inArray(orderItemAdditions.orderItemId, notifyItemIds))
          .orderBy(asc(breadAdditions.sortOrder))
      : [];
    const addsByItem: Record<number, string[]> = {};
    for (const a of addRows) {
      if (!addsByItem[a.orderItemId]) addsByItem[a.orderItemId] = [];
      addsByItem[a.orderItemId].push(a.name);
    }

    const staffItems = notifyRows.map((r) => ({
      breadTypeName: formatStaffItemLabel(r.typeName, r.sizeName, r.weightGrams, addsByItem[r.itemId] ?? []),
      quantity: r.quantity,
    }));

    if (cust) {
      await notifyNewOrder(order.groupId, createdOrderId, {
        customerName: cust.name,
        items: staffItems,
        deliveryDate: nextDeliveryDate,
        notes: order.notes,
      });
    }
  } catch (err) {
    console.error(`Failed to notify baker of recurring clone ${createdOrderId}:`, err);
  }

  return createdOrderId;
}
