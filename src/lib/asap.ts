import { and, eq, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { groups, orders } from '@/db/schema';

/**
 * Where בהקדם orders (open, no delivery date) appear. One switch per bakery
 * decides it for every view that shows orders by day: the home screen, the
 * baker tab, print, the kitchen screen and the Telegram texts read it here,
 * and the mini-app lists get it from their API (src/lib/order-grouping.ts).
 */
export interface OrderDisplay {
  asapInToday: boolean;
  kitchenShowRecipe: boolean;
}

export async function getOrderDisplay(groupId: number): Promise<OrderDisplay> {
  const [row] = await db
    .select({ asapInToday: groups.asapInToday, kitchenShowRecipe: groups.kitchenShowRecipe })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return { asapInToday: row?.asapInToday ?? false, kitchenShowRecipe: row?.kitchenShowRecipe ?? true };
}

/** A בהקדם order: still open and with no date. Delivering one stamps today's date. */
export function openUndated(): SQL {
  return and(isNull(orders.deliveryDate), notInArray(orders.status, ['delivered', 'cancelled']))!;
}

/** Today's orders; with the switch on, the בהקדם ones too. Callers add their own status rules. */
export function todayCondition(today: string, asapInToday: boolean): SQL {
  return asapInToday ? or(eq(orders.deliveryDate, today), openUndated())! : eq(orders.deliveryDate, today);
}

/** Sort key that puts undated rows first; follow it with asc(orders.id) for oldest first. */
export const undatedFirst = sql`${orders.deliveryDate} is not null`;
