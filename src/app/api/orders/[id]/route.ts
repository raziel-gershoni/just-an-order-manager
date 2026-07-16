import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, customerPhones, breadTypes, breadSizes, breadAdditions, orderItemAdditions, breadRecipes, breadRecipeIngredients } from '@/db/schema';
import { eq, and, inArray, sql, asc } from 'drizzle-orm';
import { z } from 'zod/v4';
import { resolveDeliveryDate } from '@/lib/date-utils';
import { scaleRecipe, type Recipe, type ScaledRecipe } from '@/lib/recipe';
import { goodsForRead, orderTotalFromGoods, priceOrderForWrite } from '@/lib/order-pricing';
import { resolveAndPriceOrderLines, type ResolvedOrderLine } from '@/lib/order-lines';

function getOrderId(url: string): number {
  return Number(new URL(url).pathname.split('/').at(-1));
}

export const GET = withGroup(async (request, auth, groupId) => {
  const id = getOrderId(request.url);
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  const isBaker = role === 'baker';

  const [order] = await db
    .select({
      id: orders.id,
      deliveryType: orders.deliveryType,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      notes: orders.notes,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      customerName: customers.name,
      customerId: customers.id,
      totalOverride: orders.totalOverride,
      paid: orders.paid,
      isRecurring: orders.isRecurring,
      isDelivery: orders.isDelivery,
      deliveryFee: orders.deliveryFee,
      dealsEnabled: orders.dealsEnabled,
      additionsCharged: orders.additionsCharged,
      goodsSnapshot: orders.goodsSnapshot,
      pricingBreakdown: orders.pricingBreakdown,
      customerAddress: customers.address,
      customerCity: customers.city,
      customerDeliveryNotes: customers.deliveryNotes,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(and(eq(orders.id, id), eq(orders.groupId, groupId)))
    .limit(1);

  if (!order) return errorResponse('Order not found', 404);

  const itemRows = await db
    .select({
      id: orderItems.id,
      breadTypeId: orderItems.breadTypeId,
      breadTypeName: breadTypes.name,
      breadSizeId: orderItems.breadSizeId,
      sizeName: breadSizes.name,
      sizeWeightGrams: breadSizes.weightGrams,
      quantity: orderItems.quantity,
      pricePerUnit: orderItems.pricePerUnit,
      additionsCharged: orderItems.additionsCharged,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
    .where(eq(orderItems.orderId, order.id));

  // Fetch additions per item
  const itemIds = itemRows.map((i) => i.id);
  const additionLinks = itemIds.length
    ? await db
        .select({
          orderItemId: orderItemAdditions.orderItemId,
          breadAdditionId: breadAdditions.id,
          name: breadAdditions.name,
          sortOrder: breadAdditions.sortOrder,
        })
        .from(orderItemAdditions)
        .innerJoin(breadAdditions, eq(orderItemAdditions.breadAdditionId, breadAdditions.id))
        .where(inArray(orderItemAdditions.orderItemId, itemIds))
    : [];

  const additionsByItem: Record<number, { id: number; name: string }[]> = {};
  for (const a of additionLinks) {
    if (!additionsByItem[a.orderItemId]) additionsByItem[a.orderItemId] = [];
    additionsByItem[a.orderItemId].push({ id: a.breadAdditionId, name: a.name });
  }

  // Fetch recipes for involved bread types and scale per item (per-loaf, qty=1)
  const involvedTypeIds = Array.from(new Set(itemRows.map((i) => i.breadTypeId)));
  const recipeRows = involvedTypeIds.length
    ? await db
        .select()
        .from(breadRecipes)
        .where(inArray(breadRecipes.breadTypeId, involvedTypeIds))
    : [];
  const ingredientRows = recipeRows.length
    ? await db
        .select()
        .from(breadRecipeIngredients)
        .where(inArray(breadRecipeIngredients.breadTypeId, involvedTypeIds))
        .orderBy(asc(breadRecipeIngredients.sortOrder))
    : [];
  const recipeByType = new Map<number, Recipe>();
  for (const r of recipeRows) recipeByType.set(r.breadTypeId, { ingredients: [] });
  for (const i of ingredientRows) {
    const r = recipeByType.get(i.breadTypeId);
    if (!r) continue;
    r.ingredients.push({
      name: i.name,
      kind: i.kind,
      pctOfFinished: Number(i.pctOfFinished),
      sortOrder: i.sortOrder,
    });
  }

  const items = itemRows.map((i) => {
    let recipe: ScaledRecipe | null = null;
    const r = recipeByType.get(i.breadTypeId);
    if (r && r.ingredients.length > 0 && i.sizeWeightGrams != null) {
      recipe = scaleRecipe(r, i.sizeWeightGrams);
    }
    return {
      ...i,
      additions: additionsByItem[i.id] ?? [],
      hasRecipe: recipe != null,
      recipe,
    };
  });

  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  // Bundled goods total: prefers the frozen snapshot, falls back to Σ qty×price
  // for legacy orders (identical to before).
  const calculatedTotal = goodsForRead(order, items);
  const deliveryFee = Number(order.deliveryFee || 0);
  const totalPrice = orderTotalFromGoods(order, calculatedTotal);

  // Count of customer phones — used by the order UI to decide whether to
  // show the "notify customer" checkbox on status changes.
  const [{ phoneCount }] = await db
    .select({ phoneCount: sql<number>`COUNT(*)::int` })
    .from(customerPhones)
    .where(eq(customerPhones.customerId, order.customerId));

  // Bakers don't see delivery details (navigable address / private notes).
  const customerAddress = isBaker ? null : order.customerAddress;
  const customerCity = isBaker ? null : order.customerCity;
  const customerDeliveryNotes = isBaker ? null : order.customerDeliveryNotes;

  return jsonResponse({
    order: {
      ...order,
      customerAddress,
      customerCity,
      customerDeliveryNotes,
      deliveryFee,
      items,
      totalQuantity,
      totalPrice,
      calculatedTotal,
      customerPhoneCount: phoneCount,
    },
  });
});

const updateOrderSchema = z.object({
  deliveryType: z.enum(['weekly', 'shabbat', 'specific_date', 'asap']).optional(),
  deliveryDate: z.string().optional(),
  notes: z.string().max(1000).optional(),
  totalOverride: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  isDelivery: z.boolean().optional(),
  deliveryFee: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  isRecurring: z.boolean().optional(),
  dealsEnabled: z.boolean().optional(),
  additionsCharged: z.boolean().optional(),
  items: z.array(z.object({
    breadTypeId: z.number().int().positive(),
    breadSizeId: z.number().int().positive(),
    breadAdditionIds: z.array(z.number().int().positive()).optional(),
    quantity: z.number().int().positive(),
    additionsCharged: z.boolean().nullable().optional(), // null/undefined = inherit order default
  })).min(1).optional(),
});

export const PATCH = withGroup(async (request, auth, groupId) => {
  const id = getOrderId(request.url);
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role === 'driver') return errorResponse('Forbidden', 403);

  const body = await request.json();
  const parsed = updateOrderSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  // Pricing flags (deals / charge-additions) change per-line prices, so the goods
  // snapshot is only re-frozen when items are present. Require items alongside a
  // flag change so the snapshot can't go stale (the order form always co-sends
  // them; this just makes that coupling an API contract).
  if (
    (parsed.data.dealsEnabled !== undefined || parsed.data.additionsCharged !== undefined) &&
    parsed.data.items === undefined
  ) {
    return errorResponse('Pricing changes must include items', 400);
  }

  // Fetch existing order
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.groupId, groupId)))
    .limit(1);

  if (!order) return errorResponse('Order not found', 404);
  if (order.status === 'delivered' || order.status === 'cancelled') {
    return errorResponse('Cannot edit completed or cancelled orders', 400);
  }

  // Detect whether this edit actually changes the order's pricing inputs. The
  // order form ALWAYS co-sends the full items array even for a notes/date/fee
  // -only edit, so "items present" alone must NOT trigger a re-price — that
  // would silently re-bundle a placed (or legacy) order against the current tier
  // config. We compare the submitted lines against the persisted ones and only
  // re-price when they (or a pricing flag) genuinely differ. The fingerprint
  // round-trips only run when items are actually submitted.
  let itemsChanged = false;
  if (parsed.data.items !== undefined) {
    const existingItemRows = await db
      .select({
        id: orderItems.id,
        breadTypeId: orderItems.breadTypeId,
        breadSizeId: orderItems.breadSizeId,
        quantity: orderItems.quantity,
        additionsCharged: orderItems.additionsCharged,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, id));
    const existingItemIds = existingItemRows.map((i) => i.id);
    const existingAdditionLinks = existingItemIds.length
      ? await db
          .select({
            orderItemId: orderItemAdditions.orderItemId,
            breadAdditionId: orderItemAdditions.breadAdditionId,
          })
          .from(orderItemAdditions)
          .where(inArray(orderItemAdditions.orderItemId, existingItemIds))
      : [];
    const existingAddByItem: Record<number, number[]> = {};
    for (const a of existingAdditionLinks) {
      (existingAddByItem[a.orderItemId] ??= []).push(a.breadAdditionId);
    }
    // Canonical, order-independent fingerprint of a line's pricing inputs.
    const canonLine = (
      breadTypeId: number,
      breadSizeId: number | null,
      quantity: number,
      additionIds: number[],
      additionsCharged: boolean | null | undefined
    ) =>
      `${breadTypeId}:${breadSizeId}:${quantity}:${[...additionIds].sort((a, b) => a - b).join(',')}:${
        additionsCharged == null ? 'n' : additionsCharged ? '1' : '0'
      }`;
    const canonSet = (lines: string[]) => lines.slice().sort().join('|');
    const existingCanon = canonSet(
      existingItemRows.map((i) =>
        canonLine(i.breadTypeId, i.breadSizeId, i.quantity, existingAddByItem[i.id] ?? [], i.additionsCharged)
      )
    );
    const submittedCanon = canonSet(
      parsed.data.items.map((i) =>
        canonLine(i.breadTypeId, i.breadSizeId, i.quantity, i.breadAdditionIds ?? [], i.additionsCharged)
      )
    );
    itemsChanged = submittedCanon !== existingCanon;
  }
  const pricingFlagsChanged =
    (parsed.data.dealsEnabled !== undefined && parsed.data.dealsEnabled !== order.dealsEnabled) ||
    (parsed.data.additionsCharged !== undefined &&
      parsed.data.additionsCharged !== order.additionsCharged);
  const shouldReprice = parsed.data.items !== undefined && (itemsChanged || pricingFlagsChanged);

  // Build update data
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (parsed.data.deliveryType) {
    updateData.deliveryType = parsed.data.deliveryType;
    updateData.deliveryDate = resolveDeliveryDate(
      parsed.data.deliveryType,
      parsed.data.deliveryDate
    );
  } else if (parsed.data.deliveryDate !== undefined) {
    updateData.deliveryDate = parsed.data.deliveryDate || null;
  }

  if (parsed.data.notes !== undefined) {
    updateData.notes = parsed.data.notes || null;
  }

  if (parsed.data.totalOverride !== undefined) {
    updateData.totalOverride = parsed.data.totalOverride;
  }

  if (parsed.data.isRecurring !== undefined) {
    updateData.isRecurring = parsed.data.isRecurring;
  }

  if (parsed.data.dealsEnabled !== undefined) {
    updateData.dealsEnabled = parsed.data.dealsEnabled;
  }

  if (parsed.data.additionsCharged !== undefined) {
    updateData.additionsCharged = parsed.data.additionsCharged;
  }

  // Effective "charge additions" flag for recomputing per-line prices below.
  const chargeAdd = parsed.data.additionsCharged ?? order.additionsCharged;

  if (parsed.data.isDelivery !== undefined) {
    updateData.isDelivery = parsed.data.isDelivery;
    // Fee only meaningful when delivering; clear it on pickup.
    updateData.deliveryFee = parsed.data.isDelivery
      ? parsed.data.deliveryFee ?? order.deliveryFee ?? '0'
      : '0';
  } else if (parsed.data.deliveryFee !== undefined) {
    updateData.deliveryFee = parsed.data.deliveryFee;
  }

  // Validate + price the new lines BEFORE mutating anything, so a bad line can't
  // leave the order header partially updated. Only runs when actually repricing;
  // shouldReprice already implies items are present.
  let pricedLines: ResolvedOrderLine[] | null = null;
  let pricedSurcharge = 0;
  if (shouldReprice && parsed.data.items) {
    const priced = await resolveAndPriceOrderLines(groupId, parsed.data.items, chargeAdd);
    if (!priced.ok) return errorResponse(priced.error, priced.status);
    pricedLines = priced.lines;
    pricedSurcharge = priced.surcharge;
  }

  // Update order fields
  await db
    .update(orders)
    .set(updateData)
    .where(eq(orders.id, id));

  // Rewrite items only when they (or a pricing flag) changed — an identical
  // resend keeps the frozen rows + prices untouched. Lines are already validated.
  if (pricedLines) {
    // Clear old item->addition junction rows first (FK to order_items would block delete)
    const oldItems = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.orderId, id));
    if (oldItems.length > 0) {
      await db.delete(orderItemAdditions).where(
        inArray(orderItemAdditions.orderItemId, oldItems.map((i) => i.id))
      );
    }
    await db.delete(orderItems).where(eq(orderItems.orderId, id));
    const insertedItems = await db
      .insert(orderItems)
      .values(
        pricedLines.map((l) => ({
          orderId: id,
          breadTypeId: l.breadTypeId,
          breadSizeId: l.breadSizeId,
          quantity: l.quantity,
          pricePerUnit: l.pricePerUnit,
          additionsCharged: l.additionsCharged,
        }))
      )
      .returning();

    // Persist new additions per inserted item
    const additionInserts: { orderItemId: number; breadAdditionId: number }[] = [];
    for (let i = 0; i < pricedLines.length; i++) {
      for (const aid of pricedLines[i].breadAdditionIds) {
        additionInserts.push({ orderItemId: insertedItems[i].id, breadAdditionId: aid });
      }
    }
    if (additionInserts.length > 0) {
      await db.insert(orderItemAdditions).values(additionInserts);
    }
  }

  // Return full order with items (matching GET format)
  const [updated] = await db
    .select({
      id: orders.id,
      deliveryType: orders.deliveryType,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      notes: orders.notes,
      totalOverride: orders.totalOverride,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      customerName: customers.name,
      customerId: customers.id,
      paid: orders.paid,
      isRecurring: orders.isRecurring,
      isDelivery: orders.isDelivery,
      deliveryFee: orders.deliveryFee,
      dealsEnabled: orders.dealsEnabled,
      additionsCharged: orders.additionsCharged,
      goodsSnapshot: orders.goodsSnapshot,
      pricingBreakdown: orders.pricingBreakdown,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(eq(orders.id, id))
    .limit(1);

  const updatedItemRows = await db
    .select({
      id: orderItems.id,
      breadTypeId: orderItems.breadTypeId,
      breadTypeName: breadTypes.name,
      breadSizeId: orderItems.breadSizeId,
      sizeName: breadSizes.name,
      quantity: orderItems.quantity,
      pricePerUnit: orderItems.pricePerUnit,
      additionsCharged: orderItems.additionsCharged,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
    .where(eq(orderItems.orderId, id));

  const updatedItemIds = updatedItemRows.map((i) => i.id);
  const updatedAdditionLinks = updatedItemIds.length
    ? await db
        .select({
          orderItemId: orderItemAdditions.orderItemId,
          breadAdditionId: breadAdditions.id,
          name: breadAdditions.name,
        })
        .from(orderItemAdditions)
        .innerJoin(breadAdditions, eq(orderItemAdditions.breadAdditionId, breadAdditions.id))
        .where(inArray(orderItemAdditions.orderItemId, updatedItemIds))
    : [];
  const updatedAdditionsByItem: Record<number, { id: number; name: string }[]> = {};
  for (const a of updatedAdditionLinks) {
    if (!updatedAdditionsByItem[a.orderItemId]) updatedAdditionsByItem[a.orderItemId] = [];
    updatedAdditionsByItem[a.orderItemId].push({ id: a.breadAdditionId, name: a.name });
  }

  const updatedItems = updatedItemRows.map((i) => ({
    ...i,
    additions: updatedAdditionsByItem[i.id] ?? [],
  }));

  const totalQuantity = updatedItems.reduce((s, i) => s + i.quantity, 0);
  const fee = Number(updated.deliveryFee || 0);

  // Re-price + re-freeze the goods snapshot ONLY when the items actually changed.
  // A non-item edit (date, notes, fee, override) must never re-bundle an order
  // against the current tier config — that would silently change a placed (or
  // legacy, snapshot=null) order's price. On those edits we keep the frozen
  // snapshot (or legacy Σ) via goodsForRead and never write a snapshot.
  let calculatedTotal: number;
  let breakdown = updated.pricingBreakdown;
  if (pricedLines) {
    // Reuse the write-lines the helper already built — no re-derivation of the
    // base price by subtracting the surcharge back off.
    const pricing = await priceOrderForWrite(groupId, pricedLines.map((l) => l.writeLine), {
      dealsEnabled: updated.dealsEnabled,
      deliveryFee: fee,
      totalOverride: updated.totalOverride ? Number(updated.totalOverride) : null,
      surcharge: pricedSurcharge,
    });
    await db
      .update(orders)
      .set({ goodsSnapshot: pricing.goods.toFixed(2), pricingBreakdown: pricing.rows })
      .where(eq(orders.id, id));
    breakdown = pricing.rows;
    calculatedTotal = pricing.goods;
  } else {
    calculatedTotal = goodsForRead(updated, updatedItems);
  }
  const totalPrice = orderTotalFromGoods(updated, calculatedTotal);

  return jsonResponse({
    order: {
      ...updated,
      deliveryFee: fee,
      pricingBreakdown: breakdown,
      items: updatedItems,
      totalQuantity,
      totalPrice,
      calculatedTotal,
    },
  });
});
