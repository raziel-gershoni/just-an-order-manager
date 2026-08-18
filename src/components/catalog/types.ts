/** Shapes the bread sheet and its sections share, straight off the detail endpoint. */

export interface TypeDetailSize {
  id: number;
  name: string;
  weightGrams: number | null;
  price: string;
  isDefault: boolean;
  enabled: boolean;
  priceOverride: string | null;
  badgeType: string | null;
  badgeLabel: string | null;
  badgeIcon: string | null;
}

export interface TypeDetailAddition {
  id: number;
  name: string;
  isDefault: boolean;
  enabled: boolean;
}

/** Bulk-pricing quantity tier. breadTypeId null = the size-wide default. */
export interface Tier {
  id: number;
  breadSizeId: number;
  breadTypeId: number | null;
  minQty: number;
  price: string;
}
