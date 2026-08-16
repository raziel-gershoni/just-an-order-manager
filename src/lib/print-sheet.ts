import { db } from '@/db';
import {
  orders,
  orderItems,
  customers,
  customerPhones,
  breadTypes,
  breadSizes,
  breadAdditions,
  orderItemAdditions,
} from '@/db/schema';
import { and, asc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { format, addDays, parseISO, isValid } from 'date-fns';
import { he } from 'date-fns/locale/he';
import { todayStr } from './date-utils';
import { formatStaffItemLabel } from './order-display';
import { calculateOrderTotal } from './order-payments';
import { aggregateRecipesForOrders } from './order-recipe';
import { groupByKind, kindLabel, kindLabelIsUseful, type IngredientKind } from './recipe';

/**
 * Everything one printed packing sheet needs, in one read.
 *
 * The sheet follows the day's work in order: what to weigh into the mixer, how
 * many loaves to shape, and then what goes in each bag. Item labels come from
 * `formatStaffItemLabel`, the same staff wording the baker sees in Telegram;
 * totals from `calculateOrderTotal`; and the weights from
 * `aggregateRecipesForOrders`, the same scaling the baker screen and the
 * morning digest use — so a printed sheet can never quote a figure another
 * surface disagrees with.
 */

export const PRINT_PRESETS = ['yesterday', 'today', 'tomorrow', 'active'] as const;
export type PrintPreset = (typeof PRINT_PRESETS)[number];

export interface PrintLine {
  label: string;
  qty: number;
}

export interface PrintOrder {
  id: number;
  customerName: string;
  phone: string | null;
  deliveryDate: string | null;
  isDelivery: boolean;
  address: string | null;
  notes: string | null;
  status: string;
  paid: boolean;
  total: number;
  items: PrintLine[];
}

export interface PrintRecipeLine {
  name: string;
  grams: number;
  /** Baker's percent — the ratio a baker checks a dough by. */
  pctOfFlour: number;
}

export interface PrintRecipeGroup {
  kind: IngredientKind;
  /** The heading to print, or null where the kind says nothing the line doesn't. */
  label: string | null;
  /** Only set for a group of two or more — a "total" of one line is just the line. */
  totalGrams: number | null;
  lines: PrintRecipeLine[];
}

export interface PrintRecipeBlock {
  name: string;
  loaves: number;
  finishedGrams: number;
  flourGrams: number;
  doughGrams: number;
  groups: PrintRecipeGroup[];
}

export interface PrintSheet {
  /** What this sheet covers, e.g. "יום ו׳ 15/08" or "כל ההזמנות הפעילות". */
  heading: string;
  /** The date the presets resolved to, or null for the active-orders view. */
  date: string | null;
  recipes: PrintRecipeBlock[];
  /** Types on the sheet with no recipe at all — named so the weights above can't read as the whole job. */
  noRecipe: string[];
  /** Types whose weights are short a size that carries no gram weight. */
  partialRecipe: string[];
  production: PrintLine[];
  totalLoaves: number;
  orders: PrintOrder[];
}

/** A preset name, an explicit yyyy-MM-dd, or nothing → today. */
export function resolveRange(raw: string | undefined): {
  date: string | null;
  preset: PrintPreset | null;
} {
  if (raw === 'active') return { date: null, preset: 'active' };
  if (raw === 'yesterday') return { date: shift(-1), preset: 'yesterday' };
  if (raw === 'tomorrow') return { date: shift(1), preset: 'tomorrow' };
  if (raw && raw !== 'today') {
    const parsed = parseISO(raw);
    // An unparseable date in the URL falls back to today rather than erroring —
    // this is a sheet someone is trying to print, not an API.
    if (isValid(parsed)) {
      const d = format(parsed, 'yyyy-MM-dd');
      return { date: d, preset: presetFor(d) };
    }
  }
  return { date: todayStr(), preset: 'today' };
}

function shift(days: number): string {
  return format(addDays(new Date(), days), 'yyyy-MM-dd');
}

/** So an explicit date that happens to be today still lights the right tab. */
function presetFor(date: string): PrintPreset | null {
  if (date === todayStr()) return 'today';
  if (date === shift(-1)) return 'yesterday';
  if (date === shift(1)) return 'tomorrow';
  return null;
}

export function headingFor(date: string | null): string {
  if (!date) return 'כל ההזמנות הפעילות';
  const d = parseISO(date);
  return isValid(d) ? format(d, 'EEEE d בMMMM', { locale: he }) : date;
}

export async function buildPrintSheet(
  groupId: number,
  date: string | null
): Promise<PrintSheet> {
  // A dated sheet keeps delivered orders — printing yesterday is how you check
  // what went out. The active view is the opposite: only what's still open.
  const rows = await db
    .select({
      id: orders.id,
      customerId: customers.id,
      customerName: customers.name,
      address: customers.address,
      city: customers.city,
      deliveryDate: orders.deliveryDate,
      isDelivery: orders.isDelivery,
      notes: orders.notes,
      status: orders.status,
      paid: orders.paid,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(
      date
        ? and(
            eq(orders.groupId, groupId),
            eq(orders.deliveryDate, date),
            ne(orders.status, 'cancelled')
          )
        : and(
            eq(orders.groupId, groupId),
            notInArray(orders.status, ['delivered', 'cancelled'])
          )
    )
    // ASAP orders carry no date; on the active sheet they're the most urgent
    // thing on it, so they lead rather than sink to the bottom.
    .orderBy(
      sql`coalesce(${orders.deliveryDate}, ${orders.createdAt}::date) asc nulls first`,
      asc(orders.id)
    );

  if (rows.length === 0) {
    return {
      heading: headingFor(date),
      date,
      recipes: [],
      noRecipe: [],
      partialRecipe: [],
      production: [],
      totalLoaves: 0,
      orders: [],
    };
  }

  const orderIds = rows.map((r) => r.id);
  const items = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      typeName: breadTypes.name,
      sizeName: breadSizes.name,
      weightGrams: breadSizes.weightGrams,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(breadTypes, eq(orderItems.breadTypeId, breadTypes.id))
    .leftJoin(breadSizes, eq(orderItems.breadSizeId, breadSizes.id))
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.id));

  const itemIds = items.map((i) => i.id);
  const additionRows = itemIds.length
    ? await db
        .select({ orderItemId: orderItemAdditions.orderItemId, name: breadAdditions.name })
        .from(orderItemAdditions)
        .innerJoin(breadAdditions, eq(orderItemAdditions.breadAdditionId, breadAdditions.id))
        .where(inArray(orderItemAdditions.orderItemId, itemIds))
        .orderBy(asc(breadAdditions.sortOrder))
    : [];
  const additionsByItem: Record<number, string[]> = {};
  for (const a of additionRows) {
    (additionsByItem[a.orderItemId] ??= []).push(a.name);
  }

  const phoneRows = await db
    .select({ customerId: customerPhones.customerId, phone: customerPhones.phone })
    .from(customerPhones)
    .where(inArray(customerPhones.customerId, [...new Set(rows.map((r) => r.customerId))]))
    .orderBy(asc(customerPhones.sortOrder), asc(customerPhones.id));
  const phoneByCustomer = new Map<number, string>();
  for (const p of phoneRows) {
    if (!phoneByCustomer.has(p.customerId)) phoneByCustomer.set(p.customerId, p.phone);
  }

  const [totals, recipeAgg] = await Promise.all([
    Promise.all(rows.map((r) => calculateOrderTotal(r.id))),
    aggregateRecipesForOrders(orderIds),
  ]);

  const itemsByOrder = new Map<number, PrintLine[]>();
  const production = new Map<string, number>();
  for (const i of items) {
    const label = formatStaffItemLabel(
      i.typeName,
      i.sizeName,
      i.weightGrams,
      additionsByItem[i.id] ?? []
    );
    const line = itemsByOrder.get(i.orderId) ?? [];
    line.push({ label, qty: i.quantity });
    itemsByOrder.set(i.orderId, line);
    // The tally ignores additions — you shape a loaf, you don't shape a topping.
    const bake = formatStaffItemLabel(i.typeName, i.sizeName, i.weightGrams, []);
    production.set(bake, (production.get(bake) ?? 0) + i.quantity);
  }

  const printOrders: PrintOrder[] = rows.map((r, idx) => ({
    id: r.id,
    customerName: r.customerName,
    phone: phoneByCustomer.get(r.customerId) ?? null,
    deliveryDate: r.deliveryDate,
    isDelivery: r.isDelivery,
    address: r.isDelivery ? [r.address, r.city].filter(Boolean).join(', ') || null : r.city,
    notes: r.notes,
    status: r.status,
    paid: r.paid,
    total: totals[idx],
    items: itemsByOrder.get(r.id) ?? [],
  }));

  const productionLines = [...production.entries()]
    .map(([label, qty]) => ({ label, qty }))
    .sort((a, b) => b.qty - a.qty || a.label.localeCompare(b.label, 'he'));

  // A type whose sizes all lack a gram weight scales to an empty recipe; there
  // is nothing to weigh out, so it belongs in the caveat line, not the block.
  const recipes: PrintRecipeBlock[] = recipeAgg.byType
    .filter((t) => t.hasRecipe && t.recipe && t.recipe.ingredients.length > 0)
    .map((t) => ({
      name: t.name,
      loaves: t.totalLoaves,
      finishedGrams: t.recipe!.finishedGrams,
      flourGrams: t.recipe!.totalFlourGrams,
      doughGrams: t.recipe!.totalDoughGrams,
      groups: groupByKind(t.recipe!.ingredients).map((g) => ({
        kind: g.kind,
        label: kindLabelIsUseful(g.kind, g.items) ? kindLabel(g.kind) : null,
        totalGrams:
          g.items.length > 1 ? g.items.reduce((sum, i) => sum + i.grams, 0) : null,
        lines: g.items.map((i) => ({
          name: i.name,
          grams: i.grams,
          pctOfFlour: i.pctOfFlour,
        })),
      })),
    }))
    .sort((a, b) => b.doughGrams - a.doughGrams);

  const named = (reason: 'no_recipe' | 'size_missing_weight') =>
    recipeAgg.unconfigured.filter((u) => u.reason === reason).map((u) => u.name);

  return {
    heading: headingFor(date),
    date,
    recipes,
    noRecipe: named('no_recipe'),
    partialRecipe: named('size_missing_weight'),
    production: productionLines,
    totalLoaves: productionLines.reduce((s, l) => s + l.qty, 0),
    orders: printOrders,
  };
}
