import { db } from '@/db';
import { orders, orderItems, orderItemAdditions, breadTypes, breadSizes, breadAdditions } from '@/db/schema';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod/v4';
import { pricingKey } from './order-fingerprint';
import { resolveAndPriceOrderLines } from './order-lines';
import { goodsForRead, orderTotalFromGoods, priceOrderForWrite } from './order-pricing';
import type { Allocation } from './pricing';
import { fridayOfWeek, nextRecurringDate, rollWeeklyPast, todayStr } from './date-utils';
import {
  isFridayType,
  sectionsOf,
  type NextChange,
  type NextChangeBasket,
  type NextChangeItem,
  type NextChangeSection,
  type NextOccurrenceView,
} from './order-next-change-types';

type OrderRow = typeof orders.$inferSelect;

const CLOSED: OrderRow['status'][] = ['delivered', 'cancelled'];

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^\d+(\.\d{1,2})?$/);

// What is stored. Read back defensively: a row that fails this is treated as
// "no change" by the clone (and said so in the baker's ping), never trusted.
const storedSchema = z.object({
  v: z.literal(1),
  basket: z
    .object({
      items: z
        .array(
          z.object({
            breadTypeId: z.number().int().positive(),
            breadSizeId: z.number().int().positive().nullable(),
            quantity: z.number().int().positive(),
            pricePerUnit: z.string().nullable(),
            additionsCharged: z.boolean().nullable(),
            breadAdditionIds: z.array(z.number().int().positive()),
          })
        )
        .min(1),
      dealsEnabled: z.boolean(),
      additionsCharged: z.boolean(),
      goodsSnapshot: z.string().nullable(),
      pricingBreakdown: z.array(z.any()).nullable(),
      totalOverride: z.string().nullable(),
      isDelivery: z.boolean(),
      deliveryFee: z.string(),
    })
    .optional(),
  notes: z.string().nullable().optional(),
  schedule: z
    .object({
      deliveryType: z.enum(['shabbat', 'weekly', 'specific_date']),
      deliveryDate: dateStr,
    })
    .optional(),
});

/** The stored change, or null when there is none or it can't be trusted. */
export function parseNextChange(raw: unknown): NextChange | null {
  if (raw == null) return null;
  const parsed = storedSchema.safeParse(raw);
  if (!parsed.success) return null;
  const nc = parsed.data as NextChange;
  return sectionsOf(nc).length > 0 ? nc : null;
}

/** The change without some sections, or null when nothing is left. */
export function withoutSections(change: NextChange, drop: NextChangeSection[]): NextChange | null {
  const next: NextChange = { ...change };
  for (const s of drop) delete next[s];
  return sectionsOf(next).length > 0 ? next : null;
}

/** The order form's "from next time" save — the same fields a plain edit sends. */
export const nextChangeInputSchema = z.object({
  deliveryType: z.enum(['shabbat', 'weekly', 'specific_date']),
  deliveryDate: dateStr.optional(),
  items: z
    .array(
      z.object({
        breadTypeId: z.number().int().positive(),
        breadSizeId: z.number().int().positive(),
        breadAdditionIds: z.array(z.number().int().positive()).optional(),
        quantity: z.number().int().positive(),
        additionsCharged: z.boolean().nullable().optional(),
      })
    )
    .min(1),
  notes: z.string().max(1000),
  totalOverride: money.nullable(),
  isDelivery: z.boolean(),
  deliveryFee: money,
  dealsEnabled: z.boolean(),
  additionsCharged: z.boolean(),
});
export type NextChangeInput = z.infer<typeof nextChangeInputSchema>;

export function isOpenRecurring(order: Pick<OrderRow, 'isRecurring' | 'status' | 'deliveryType'>): boolean {
  return order.isRecurring && !CLOSED.includes(order.status) && order.deliveryType !== 'asap';
}

const laterOf = (a: string, b: string | null) => (b != null && b > a ? b : a);

/** A new date for the next occurrence has to be after this. */
export function nextChangeFloor(order: Pick<OrderRow, 'deliveryDate'>): string {
  return laterOf(todayStr(), order.deliveryDate);
}

/** An order's lines as the clone copies them: frozen prices and additions included. */
export async function loadOrderBasket(orderId: number): Promise<NextChangeItem[]> {
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
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.id);
  if (items.length === 0) return [];
  const links = await db
    .select()
    .from(orderItemAdditions)
    .where(inArray(orderItemAdditions.orderItemId, items.map((i) => i.id)));
  const byItem: Record<number, number[]> = {};
  for (const l of links) (byItem[l.orderItemId] ??= []).push(l.breadAdditionId);
  return items.map(({ id, ...i }) => ({ ...i, breadAdditionIds: byItem[id] ?? [] }));
}

/** Everything the clone writes for one occurrence. */
export interface OccurrenceSpec {
  deliveryType: OrderRow['deliveryType'];
  deliveryDate: string | null;
  notes: string | null;
  totalOverride: string | null;
  isDelivery: boolean;
  deliveryFee: string;
  dealsEnabled: boolean;
  additionsCharged: boolean;
  goodsSnapshot: string | null;
  pricingBreakdown: unknown;
  items: NextChangeItem[];
}

/** The plain next occurrence: this order, a week on — what the clone has always written. */
export function plainOccurrence(order: OrderRow, items: NextChangeItem[]): OccurrenceSpec {
  return {
    deliveryType: order.deliveryType,
    deliveryDate: nextRecurringDate(order.deliveryType, order.deliveryDate),
    notes: order.notes,
    totalOverride: order.totalOverride,
    isDelivery: order.isDelivery,
    deliveryFee: order.deliveryFee,
    dealsEnabled: order.dealsEnabled,
    additionsCharged: order.additionsCharged,
    goodsSnapshot: order.goodsSnapshot,
    pricingBreakdown: order.pricingBreakdown,
    items,
  };
}

/** Where a saved schedule lands if the order is delivered today. */
function scheduledDate(order: Pick<OrderRow, 'deliveryDate'>, schedule: NonNullable<NextChange['schedule']>): string {
  // The date was chosen when the change was saved; a late delivery moves it on
  // by whole weeks, keeping the new weekday, exactly as nextRecurringDate does.
  return rollWeeklyPast(schedule.deliveryDate, nextChangeFloor(order));
}

/** The next occurrence with a saved change laid over the plain one. */
export function applyNextChange(order: OrderRow, plain: OccurrenceSpec, change: NextChange): OccurrenceSpec {
  const spec: OccurrenceSpec = { ...plain };
  if (change.basket) {
    const b = change.basket;
    spec.items = b.items;
    spec.dealsEnabled = b.dealsEnabled;
    spec.additionsCharged = b.additionsCharged;
    spec.goodsSnapshot = b.goodsSnapshot;
    spec.pricingBreakdown = b.pricingBreakdown;
    spec.totalOverride = b.totalOverride;
    spec.isDelivery = b.isDelivery;
    spec.deliveryFee = b.deliveryFee;
  }
  if (change.notes !== undefined) spec.notes = change.notes;
  if (change.schedule) {
    spec.deliveryType = change.schedule.deliveryType;
    spec.deliveryDate = scheduledDate(order, change.schedule);
  }
  return spec;
}

const sameMoney = (a: string | null, b: string | null) =>
  a == null || b == null ? a == b : Number(a) === Number(b);

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

/**
 * Save what the next occurrence should change. Only the sections that differ
 * from this order are kept, so saving the order as it is clears a waiting
 * change. A changed basket is priced here, through the one engine — unless it
 * matches this order or the change already saved, whose frozen prices it keeps,
 * so moving the day or the note never lifts a long-frozen price.
 */
export async function saveNextChange(
  groupId: number,
  orderId: number,
  input: NextChangeInput
): Promise<Result<{ nextChange: NextChange | null }>> {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.groupId, groupId)))
    .limit(1);
  if (!order) return { ok: false, status: 404, error: 'Order not found' };
  if (!isOpenRecurring(order)) {
    return { ok: false, status: 409, error: 'Not an open recurring order' };
  }

  const plainDate = nextRecurringDate(order.deliveryType, order.deliveryDate);
  if (!plainDate) return { ok: false, status: 400, error: 'Order has no delivery date' };
  const floor = nextChangeFloor(order);

  const next: NextChange = { v: 1 };
  const current = parseNextChange(order.nextChange);

  // Schedule — the next occurrence keeps its week; only the day moves.
  let date: string;
  if (input.deliveryType === 'specific_date') {
    if (!input.deliveryDate) return { ok: false, status: 400, error: 'deliveryDate is required' };
    if (input.deliveryDate <= floor) {
      return { ok: false, status: 400, error: 'The new date must be after this order' };
    }
    date = input.deliveryDate;
  } else if (current?.schedule && isFridayType(current.schedule.deliveryType)) {
    // Re-saving a Friday that is already planned keeps it. Recomputing it from
    // the plain date would move it a week on whenever this order is late,
    // since the plain date rolls past today and the planned Friday doesn't.
    date = scheduledDate(order, current.schedule);
  } else {
    date = rollWeeklyPast(fridayOfWeek(plainDate), floor);
  }
  if (input.deliveryType !== order.deliveryType || date !== plainDate) {
    next.schedule = { deliveryType: input.deliveryType, deliveryDate: date };
  }

  // Notes — stored the way PATCH stores them.
  const notes = input.notes || null;
  if (notes !== order.notes) next.notes = notes;

  // Basket
  const orderLines = await loadOrderBasket(order.id);
  const inputKey = pricingKey(input.items, input.dealsEnabled, input.additionsCharged);
  const orderKey = pricingKey(orderLines, order.dealsEnabled, order.additionsCharged);
  const fee = input.isDelivery ? input.deliveryFee : '0';
  const override = input.totalOverride;
  const basketSame =
    inputKey === orderKey &&
    sameMoney(override, order.totalOverride) &&
    input.isDelivery === order.isDelivery &&
    Number(fee) === Number(order.deliveryFee);

  if (!basketSame) {
    let priced: Pick<NextChangeBasket, 'items' | 'goodsSnapshot' | 'pricingBreakdown'>;
    const planBasket = current?.basket;
    if (inputKey === orderKey) {
      priced = {
        items: orderLines,
        goodsSnapshot: order.goodsSnapshot,
        pricingBreakdown: (order.pricingBreakdown as Allocation[] | null) ?? null,
      };
    } else if (
      planBasket &&
      inputKey === pricingKey(planBasket.items, planBasket.dealsEnabled, planBasket.additionsCharged)
    ) {
      priced = {
        items: planBasket.items,
        goodsSnapshot: planBasket.goodsSnapshot,
        pricingBreakdown: planBasket.pricingBreakdown,
      };
    } else {
      const resolved = await resolveAndPriceOrderLines(groupId, input.items, input.additionsCharged);
      if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error };
      const pricing = await priceOrderForWrite(groupId, resolved.lines.map((l) => l.writeLine), {
        dealsEnabled: input.dealsEnabled,
        deliveryFee: Number(fee),
        totalOverride: override != null ? Number(override) : null,
        surcharge: resolved.surcharge,
      });
      priced = {
        items: resolved.lines.map((l) => ({
          breadTypeId: l.breadTypeId,
          breadSizeId: l.breadSizeId,
          quantity: l.quantity,
          pricePerUnit: l.pricePerUnit,
          additionsCharged: l.additionsCharged,
          breadAdditionIds: l.breadAdditionIds,
        })),
        goodsSnapshot: pricing.goods.toFixed(2),
        pricingBreakdown: pricing.rows,
      };
    }
    next.basket = {
      ...priced,
      dealsEnabled: input.dealsEnabled,
      additionsCharged: input.additionsCharged,
      totalOverride: override != null ? Number(override).toFixed(2) : null,
      isDelivery: input.isDelivery,
      deliveryFee: Number(fee).toFixed(2),
    };
  }

  const value = sectionsOf(next).length > 0 ? next : null;
  const written = await writeNextChange(groupId, orderId, value);
  if (!written) return { ok: false, status: 409, error: 'Order was already delivered or stopped repeating' };
  return { ok: true, nextChange: value };
}

/**
 * The one write of next_change. Guarded on the order still being open and
 * recurring, so a change saved a moment after delivery is refused rather than
 * left on a delivered row nothing will read again.
 */
async function writeNextChange(groupId: number, orderId: number, value: NextChange | null): Promise<boolean> {
  const rows = await db
    .update(orders)
    .set({ nextChange: value, updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.groupId, groupId),
        eq(orders.isRecurring, true),
        notInArray(orders.status, CLOSED)
      )
    )
    .returning({ id: orders.id });
  return rows.length > 0;
}

export async function discardNextChange(groupId: number, orderId: number): Promise<Result<object>> {
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.groupId, groupId)))
    .limit(1);
  if (!order) return { ok: false, status: 404, error: 'Order not found' };
  // Refused once delivered: by then the change is already in the next order,
  // and saying "discarded" would be false.
  if (!(await writeNextChange(groupId, orderId, null))) {
    return { ok: false, status: 409, error: 'Order was already delivered or stopped repeating' };
  }
  return { ok: true };
}

/** GET /orders/[id]'s view of the next occurrence, or null when there is none to change. */
export async function buildNextOccurrenceView(
  order: Pick<OrderRow, 'groupId' | 'isRecurring' | 'status' | 'deliveryType' | 'deliveryDate' | 'nextChange'>
): Promise<NextOccurrenceView | null> {
  if (!isOpenRecurring(order)) return null;
  const plainDate = nextRecurringDate(order.deliveryType, order.deliveryDate);
  const change = parseNextChange(order.nextChange);
  const view: NextOccurrenceView = {
    plainDate,
    date: change?.schedule ? scheduledDate(order, change.schedule) : plainDate,
    floor: nextChangeFloor(order),
    change: null,
  };
  if (!change) return view;

  view.change = { sections: sectionsOf(change) };
  if (change.notes !== undefined) view.change.notes = change.notes;
  if (change.schedule) view.change.schedule = change.schedule;
  if (change.basket) {
    const b = change.basket;
    const typeIds = [...new Set(b.items.map((i) => i.breadTypeId))];
    const sizeIds = [...new Set(b.items.map((i) => i.breadSizeId).filter((s): s is number => s != null))];
    const addIds = [...new Set(b.items.flatMap((i) => i.breadAdditionIds))];
    const [typeRows, sizeRows, addRows] = await Promise.all([
      db
        .select({ id: breadTypes.id, name: breadTypes.name })
        .from(breadTypes)
        .where(and(inArray(breadTypes.id, typeIds), eq(breadTypes.groupId, order.groupId))),
      sizeIds.length
        ? db
            .select({ id: breadSizes.id, name: breadSizes.name })
            .from(breadSizes)
            .where(and(inArray(breadSizes.id, sizeIds), eq(breadSizes.groupId, order.groupId)))
        : Promise.resolve([]),
      addIds.length
        ? db
            .select({ id: breadAdditions.id, name: breadAdditions.name, sortOrder: breadAdditions.sortOrder })
            .from(breadAdditions)
            .where(and(inArray(breadAdditions.id, addIds), eq(breadAdditions.groupId, order.groupId)))
        : Promise.resolve([]),
    ]);
    const typeName = new Map(typeRows.map((r) => [r.id, r.name]));
    const sizeName = new Map(sizeRows.map((r) => [r.id, r.name]));
    const adds = new Map(addRows.map((r) => [r.id, r]));
    const goods = goodsForRead(b, b.items);
    view.change.basket = {
      ...b,
      deliveryFee: Number(b.deliveryFee),
      items: b.items.map((i) => ({
        ...i,
        breadTypeName: typeName.get(i.breadTypeId) ?? null,
        sizeName: i.breadSizeId != null ? sizeName.get(i.breadSizeId) ?? null : null,
        additions: i.breadAdditionIds
          .map((id) => adds.get(id))
          .filter((a): a is { id: number; name: string; sortOrder: number } => a != null)
          .sort((x, y) => x.sortOrder - y.sortOrder)
          .map(({ id, name }) => ({ id, name })),
      })),
      goods,
      total: orderTotalFromGoods(b, goods),
    };
  }
  return view;
}
