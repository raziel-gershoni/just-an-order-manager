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
import { notifyNewOrder } from './notifications';
import { formatStaffItemLabel } from './order-display';
import {
  applyNextChange,
  loadOrderBasket,
  parseNextChange,
  plainOccurrence,
  type OccurrenceSpec,
} from './order-next-change';
import type { NextChange } from './order-next-change-types';

type SourceOrder = typeof orders.$inferSelect;

/**
 * Write one occurrence: the order row, its lines, their additions. neon-http
 * has no interactive transactions, so a failure part-way is unwound by hand.
 * `cleaned` says whether that unwinding worked — a retry is only safe when it
 * did, or the half-written clone and the retry would both stand.
 */
async function insertOccurrence(
  order: SourceOrder,
  spec: OccurrenceSpec
): Promise<{ ok: true; id: number } | { ok: false; cleaned: boolean }> {
  let createdOrderId: number | null = null;
  try {
    const [nextOrder] = await db
      .insert(orders)
      .values({
        groupId: order.groupId,
        customerId: order.customerId,
        deliveryType: spec.deliveryType,
        deliveryDate: spec.deliveryDate,
        notes: spec.notes,
        totalOverride: spec.totalOverride,
        isRecurring: true,
        // Carry delivery status + fee so a recurring delivery order doesn't
        // silently regenerate as a fee-less pickup.
        isDelivery: spec.isDelivery,
        deliveryFee: spec.deliveryFee,
        // Items are copied verbatim, so the frozen pricing carries over too.
        dealsEnabled: spec.dealsEnabled,
        additionsCharged: spec.additionsCharged,
        goodsSnapshot: spec.goodsSnapshot,
        pricingBreakdown: spec.pricingBreakdown,
        // next_change is left at null: a saved change is used once.
      })
      .returning();
    createdOrderId = nextOrder.id;

    const newItems = await db
      .insert(orderItems)
      .values(
        spec.items.map((i) => ({
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
    for (let i = 0; i < spec.items.length; i++) {
      for (const aid of spec.items[i].breadAdditionIds) {
        newAdditionRows.push({ orderItemId: newItems[i].id, breadAdditionId: aid });
      }
    }
    if (newAdditionRows.length > 0) {
      await db.insert(orderItemAdditions).values(newAdditionRows);
    }
    return { ok: true, id: nextOrder.id };
  } catch (err) {
    console.error(`Failed to create next recurring order after delivering order ${order.id}:`, err);
    if (createdOrderId == null) return { ok: false, cleaned: true };
    // Unwind a half-inserted clone (a committed order row with no items would
    // otherwise surface in lists as a phantom priced order). Reverse-FK order.
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
      return { ok: false, cleaned: true };
    } catch (cleanupErr) {
      console.error(`Failed to clean up partial recurring clone ${createdOrderId}:`, cleanupErr);
      return { ok: false, cleaned: false };
    }
  }
}

/**
 * Auto-create the next occurrence of a delivered recurring order, and give the
 * baker a heads-up that reads as a renewal, not as a fresh order. Shared by every
 * delivery surface (web PATCH + Telegram inline button) so recurrence behaves
 * identically no matter who marks the order delivered.
 *
 * A change saved "from the next occurrence" (orders.next_change) is laid over
 * the copy here, the one place a next occurrence is born. If it can't be
 * written — a size deleted since it was saved, say — the plain copy is made
 * instead and the baker is told, so a planned change never ends the chain.
 *
 * Fully best-effort: the delivery + charge are already committed by the caller,
 * so nothing here throws. The notification lives in its own block so a notify
 * failure can't delete a good clone.
 *
 * Returns the new order id on full success, else null.
 */
export async function createNextRecurringOrder(order: SourceOrder): Promise<number | null> {
  let plain: OccurrenceSpec;
  let change: NextChange | null = null;
  let changeState: 'applied' | 'failed' | null = null;

  try {
    // Re-read what may have moved since the caller read the row, before the
    // delivered flip: a change saved, or the repeat stopped, in between.
    const [fresh] = await db
      .select({ isRecurring: orders.isRecurring, nextChange: orders.nextChange })
      .from(orders)
      .where(eq(orders.id, order.id))
      .limit(1);
    if (!fresh?.isRecurring) return null;
    if (fresh.nextChange != null) {
      change = parseNextChange(fresh.nextChange);
      if (!change) {
        console.error(`Unreadable next_change on recurring order ${order.id}; cloning it as it is`);
        changeState = 'failed';
      }
    }

    const items = await loadOrderBasket(order.id);
    if (items.length === 0) return null;
    // Weekly cadence: advance this order's own delivery date by 7 days.
    plain = plainOccurrence(order, items);
  } catch (err) {
    console.error(`Failed to read recurring order ${order.id} for its next occurrence:`, err);
    return null;
  }

  let spec = change ? applyNextChange(order, plain, change) : plain;
  let written = await insertOccurrence(order, spec);
  if (change) {
    changeState = written.ok ? 'applied' : 'failed';
    if (!written.ok && written.cleaned) {
      spec = plain;
      written = await insertOccurrence(order, plain);
    }
  }
  if (!written.ok) return null;
  const createdOrderId = written.id;

  // Baker heads-up — same rich staff labels (type, size, weight, additions) as a
  // manual order, but flagged `isRenewal` so it gets its own header instead of
  // hiding among the new-order pings. Separate best-effort block so a notify
  // failure can't delete a good clone.
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
        deliveryDate: spec.deliveryDate,
        notes: spec.notes,
        isRenewal: true,
        nextChange: changeState,
      });
    }
  } catch (err) {
    console.error(`Failed to notify baker of recurring clone ${createdOrderId}:`, err);
  }

  return createdOrderId;
}
