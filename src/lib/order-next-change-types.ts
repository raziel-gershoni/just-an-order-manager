// Client-safe shapes for "change a recurring order from the next occurrence".
// The server logic lives in ./order-next-change.ts.

import type { Allocation } from './pricing';

/**
 * The parts of an order a next-occurrence change can hold. Each is taken
 * whole: a change to any line, a pricing switch, the custom total, pickup vs
 * delivery or the fee is a `basket` change, because the fee and the total are
 * decided together with the goods (the free-delivery threshold reads them).
 */
export type NextChangeSection = 'basket' | 'notes' | 'schedule';
export const NEXT_CHANGE_SECTIONS: NextChangeSection[] = ['basket', 'notes', 'schedule'];

export type RecurringDeliveryType = 'shabbat' | 'weekly' | 'specific_date';

/** One line as it will be written: the frozen price travels with it. */
export interface NextChangeItem {
  breadTypeId: number;
  breadSizeId: number | null;
  quantity: number;
  pricePerUnit: string | null;
  additionsCharged: boolean | null;
  breadAdditionIds: number[];
}

export interface NextChangeBasket {
  items: NextChangeItem[];
  dealsEnabled: boolean;
  additionsCharged: boolean;
  /** Frozen goods subtotal, priced when the change was saved (null = legacy Σ). */
  goodsSnapshot: string | null;
  pricingBreakdown: Allocation[] | null;
  totalOverride: string | null;
  isDelivery: boolean;
  deliveryFee: string;
}

/**
 * What the next occurrence changes. A section that is absent is taken from the
 * order as it stands at delivery, so an edit to this week's note still carries
 * forward while a planned bread change waits. `notes: null` means "no note".
 */
export interface NextChange {
  v: 1;
  basket?: NextChangeBasket;
  notes?: string | null;
  schedule?: { deliveryType: RecurringDeliveryType; deliveryDate: string };
}

/** שבת and שבועי: one Friday rule under two labels. */
export const isFridayType = (t: string) => t === 'shabbat' || t === 'weekly';

export function sectionsOf(change: NextChange | null | undefined): NextChangeSection[] {
  if (!change) return [];
  return NEXT_CHANGE_SECTIONS.filter((s) => change[s] !== undefined);
}

export interface NextChangeViewItem extends NextChangeItem {
  breadTypeName: string | null;
  sizeName: string | null;
  additions: { id: number; name: string }[];
}

/** What GET /orders/[id] says about the next occurrence of an open recurring order. */
export interface NextOccurrenceView {
  /** Where the next order lands if nothing is changed (this order's date + a week). */
  plainDate: string | null;
  /** Where it lands with the saved change. */
  date: string | null;
  /** This order's own date or today, whichever is later: a new date must be after it. */
  floor: string;
  change: null | {
    sections: NextChangeSection[];
    notes?: string | null;
    schedule?: { deliveryType: RecurringDeliveryType; deliveryDate: string };
    basket?: Omit<NextChangeBasket, 'items' | 'deliveryFee'> & {
      items: NextChangeViewItem[];
      deliveryFee: number;
      /** Goods as frozen in the change (snapshot, else Σ qty × unit). */
      goods: number;
      /** (custom total ?? goods) + fee — the one total rule. */
      total: number;
    };
  };
}
