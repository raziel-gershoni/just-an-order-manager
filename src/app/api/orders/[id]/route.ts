import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, orderItems, customers, customerPhones, breadTypes, breadSizes, breadTypeSizes, breadAdditions, breadTypeAdditions, orderItemAdditions, breadRecipes, breadRecipeIngredients, groups } from '@/db/schema';
import { eq, and, inArray, sql, asc } from 'drizzle-orm';
import { z } from 'zod/v4';
import { resolveDeliveryDate } from '@/lib/date-utils';
import { scaleRecipe, type Recipe, type ScaledRecipe } from '@/lib/recipe';
import { goodsForRead, priceOrderForWrite, type WriteLine } from '@/lib/order-pricing';

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
  const totalPrice =
    (order.totalOverride ? Number(order.totalOverride) : calculatedTotal) + deliveryFee;

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
  items: z.array(z.object({
    breadTypeId: z.number().int().positive(),
    breadSizeId: z.number().int().positive(),
    breadAdditionIds: z.array(z.number().int().positive()).optional(),
    quantity: z.number().int().positive(),
  })).min(1).optional(),
});

export const PATCH = withGroup(async (request, auth, groupId) => {
  const id = getOrderId(request.url);
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role === 'driver') return errorResponse('Forbidden', 403);

  const body = await request.json();
  const parsed = updateOrderSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

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

  if (parsed.data.isDelivery !== undefined) {
    updateData.isDelivery = parsed.data.isDelivery;
    // Fee only meaningful when delivering; clear it on pickup.
    updateData.deliveryFee = parsed.data.isDelivery
      ? parsed.data.deliveryFee ?? order.deliveryFee ?? '0'
      : '0';
  } else if (parsed.data.deliveryFee !== undefined) {
    updateData.deliveryFee = parsed.data.deliveryFee;
  }

  // Update order fields
  await db
    .update(orders)
    .set(updateData)
    .where(eq(orders.id, id));

  // Update items if provided
  if (parsed.data.items) {
    const validTypes = await db
      .select({ id: breadTypes.id })
      .from(breadTypes)
      .where(eq(breadTypes.groupId, groupId));
    const validTypeIds = new Set(validTypes.map((t) => t.id));

    const sizeIds = parsed.data.items.map((i) => i.breadSizeId);
    const sizesInGroup = await db
      .select()
      .from(breadSizes)
      .where(and(inArray(breadSizes.id, sizeIds), eq(breadSizes.groupId, groupId)));
    const sizeMap = Object.fromEntries(sizesInGroup.map((s) => [s.id, s]));

    const typeIds = parsed.data.items.map((i) => i.breadTypeId);
    const links = await db
      .select()
      .from(breadTypeSizes)
      .where(
        and(
          inArray(breadTypeSizes.breadTypeId, typeIds),
          inArray(breadTypeSizes.breadSizeId, sizeIds)
        )
      );
    const linkMap = new Map(links.map((l) => [`${l.breadTypeId}:${l.breadSizeId}`, l]));

    // Validate additions per item
    const allAdditionIds = parsed.data.items.flatMap((i) => i.breadAdditionIds ?? []);
    const additionRows = allAdditionIds.length
      ? await db
          .select()
          .from(breadAdditions)
          .where(and(inArray(breadAdditions.id, allAdditionIds), eq(breadAdditions.groupId, groupId)))
      : [];
    const additionMap = new Map(additionRows.map((a) => [a.id, a]));

    const additionTypeLinks = allAdditionIds.length
      ? await db
          .select()
          .from(breadTypeAdditions)
          .where(
            and(
              inArray(breadTypeAdditions.breadTypeId, typeIds),
              inArray(breadTypeAdditions.breadAdditionId, allAdditionIds)
            )
          )
      : [];
    const additionLinkSet = new Set(
      additionTypeLinks.map((l) => `${l.breadTypeId}:${l.breadAdditionId}`)
    );

    const [grp] = await db
      .select({ surcharge: groups.additionsSurcharge })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    const surcharge = Number(grp?.surcharge ?? 0);

    const itemValues: typeof orderItems.$inferInsert[] = [];
    for (const item of parsed.data.items) {
      if (!validTypeIds.has(item.breadTypeId)) {
        return errorResponse(`Bread type ${item.breadTypeId} not found`, 404);
      }
      const size = sizeMap[item.breadSizeId];
      if (!size) {
        return errorResponse(`Bread size ${item.breadSizeId} not found`, 404);
      }
      const link = linkMap.get(`${item.breadTypeId}:${item.breadSizeId}`);
      if (!link) {
        return errorResponse(
          `Size ${item.breadSizeId} not enabled for type ${item.breadTypeId}`,
          400
        );
      }
      for (const aid of item.breadAdditionIds ?? []) {
        if (!additionMap.has(aid)) {
          return errorResponse(`Bread addition ${aid} not found`, 404);
        }
        if (!additionLinkSet.has(`${item.breadTypeId}:${aid}`)) {
          return errorResponse(
            `Addition ${aid} not enabled for type ${item.breadTypeId}`,
            400
          );
        }
      }
      const base = Number(link.priceOverride ?? size.price);
      const hasAdditions = (item.breadAdditionIds ?? []).length > 0;
      itemValues.push({
        orderId: id,
        breadTypeId: item.breadTypeId,
        breadSizeId: item.breadSizeId,
        quantity: item.quantity,
        pricePerUnit: (base + (hasAdditions ? surcharge : 0)).toFixed(2),
      });
    }

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
    const insertedItems = await db.insert(orderItems).values(itemValues).returning();

    // Persist new additions per inserted item
    const additionInserts: { orderItemId: number; breadAdditionId: number }[] = [];
    for (let i = 0; i < parsed.data.items.length; i++) {
      const ids = parsed.data.items[i].breadAdditionIds ?? [];
      for (const aid of ids) {
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
  if (parsed.data.items !== undefined) {
    const [grpS] = await db
      .select({ surcharge: groups.additionsSurcharge })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    const surchargeVal = Number(grpS?.surcharge ?? 0);
    const engineLines: WriteLine[] = updatedItems.map((i) => {
      const hasAdd = i.additions.length > 0;
      return {
        breadTypeId: i.breadTypeId,
        breadSizeId: i.breadSizeId,
        quantity: i.quantity,
        unitPrice: Number(i.pricePerUnit || 0) - (hasAdd ? surchargeVal : 0),
        hasAdditions: hasAdd,
      };
    });
    const pricing = await priceOrderForWrite(groupId, engineLines, {
      dealsEnabled: updated.dealsEnabled,
      deliveryFee: fee,
      totalOverride: updated.totalOverride ? Number(updated.totalOverride) : null,
      surcharge: surchargeVal,
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
  const totalPrice = (updated.totalOverride ? Number(updated.totalOverride) : calculatedTotal) + fee;

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
