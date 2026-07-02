# Tiered Bulk-Pricing Engine — Design Spec

**Date:** 2026-07-02
**Status:** Approved (owner authorized autonomous implementation to push)

## Problem

The bakery sells a "six buns" *size* priced below 6× a single bun — a bulk discount that only works for six buns of the **same** bread type. A customer ordered six buns across **different** breads and the owner still wants the bulk price. More generally, the owner wants a reusable bulk-pricing rule system (not a bun-specific hack): "6 buns → ₪40, 30 buns → ₪150", "4 loaves → ₪90", applied automatically to any quantity and any mix of breads, replacing the bundle-as-size modeling entirely.

## Core decisions (from brainstorming)

1. **Sizes become atomic.** A size is a single item (bun ₪8, loaf ₪25). Bundles are no longer modeled as sizes; they are computed pricing rules. The "six buns" size is retired (see Migration).
2. **Bread-type-dependent prices**, with a "go highest" combine rule for mixed packs (a mixed six takes the highest six-price among the breads in it).
3. **Multiple tiers per size** (6→40 *and* 30→150), any quantity supported.
4. **Cheapest combination**, not greedy: the engine charges the minimum-cost split of tiers + singles. (e.g. 4-for-₪30 + 6-for-₪48, order 8 → two 4-packs ₪60, not 6+2 singles ₪68.)
5. **"Deals off" switch** — one per-order toggle; deals on by default; off = plain singles + the existing custom-total lever.
6. **Precedence:** order custom-total (`totalOverride`) → (deals-off ? plain singles : optimized deals) → base price. Additions surcharge rides on top per unit, independent of tiers.
7. **Orders freeze.** The computed result is snapshotted at save; editing a deal later never changes a placed order.
8. **One pricing module.** All pricing collapses into a single source of truth, replacing ~5 duplicated rollups and fixing the delivery-fee inconsistency the earlier audit found.

### Safety principle: inert until configured

**With zero tiers defined and deals on, every order must price exactly as it does today** (singles). The engine ships dormant; the owner activates it by adding tiers. This makes the production deploy behavior-preserving and de-risks the autonomous push. The "six buns" size is **not** auto-deleted; the owner folds it into a tier and retires it when ready.

## Data model

### New: `bread_size_tiers`
A price tier (quantity break) for a size, optionally overridden per bread type. One table; a **null `breadTypeId` = the size default**, a set `breadTypeId` = that bread's override — mirroring how `breadSizes.price` (default) + `breadTypeSizes.priceOverride` (per-type) already work for unit prices.

```
bread_size_tiers
  id            serial pk
  groupId       int  notNull  → groups.id            // denormalized for scoping
  breadSizeId   int  notNull  → breadSizes.id
  breadTypeId   int  nullable → breadTypes.id        // null = default for the size
  minQty        int  notNull                          // the bundle size, e.g. 6, 30
  price         decimal(10,2) notNull                 // total price for a pack of minQty
  createdAt     timestamp notNull default now
  unique (breadSizeId, breadTypeId, minQty)
```

**Effective tiers for (type, size):** take all rows for the size where `breadTypeId = type OR breadTypeId IS NULL`; for each `minQty`, the type-specific row wins over the default. Result: a map `minQty → price`.

### New columns on `orders`
```
dealsEnabled   boolean notNull default true          // the "deals off" switch
goodsSnapshot  decimal(10,2) nullable                // frozen computed goods subtotal at save
pricingBreakdown jsonb nullable                       // human-readable lines for display
```
`goodsSnapshot` is the engine's goods total (before delivery fee, before `totalOverride`) computed at write time. Reads use it so a placed order never re-prices. `pricingBreakdown` holds display rows, e.g. `[{ label: "בּוּן ×6 (מארז)", amount: 45 }, { label: "בּוּן ×1", amount: 8 }]`.

`orderItems` is unchanged in shape (still type, size, additions, quantity, `pricePerUnit`). `pricePerUnit` remains the per-unit **single** price snapshot (with surcharge) for backward-compatible display and for the deals-off path; the bundle math lives at the order level via `goodsSnapshot`.

## The pricing module — `src/lib/pricing.ts`

Single source of truth. Pure functions, no DB, fully unit-testable.

### Types
```ts
type Tier = { minQty: number; price: number };            // price = total for minQty units
type PricedUnit = { breadTypeId: number; unitPrice: number; hasAdditions: boolean };
type SizeGroup = { breadSizeId: number; tiers: Tier[]; units: PricedUnit[] };
type Allocation = { label: string; amount: number };      // one breakdown row
```

### `allocateSize(group: SizeGroup, surcharge: number): { total: number; rows: Allocation[] }`
The core allocator for one bundleable size:
- If `group.tiers` is empty → every unit at its `unitPrice` (+ surcharge if `hasAdditions`). (Inert path.)
- Else compute the **minimum-cost** cover of `units.length` items using tiers + singles:
  - Singles cost = the unit's own `unitPrice`.
  - A pack of `minQty` costs `price`, and when the pack spans multiple breads it is charged **go-highest** = the max single-tier price among the breads assigned to it. Because we minimize, expensive breads are concentrated into as few packs as possible and cheap breads become singles/leftovers.
  - Additions surcharge is added **after** base allocation: `+ surcharge × (units with hasAdditions)`. Surcharge is independent of tier membership, so it does not affect the cover choice.
- Return the total and human-readable `rows`.

Because bakery quantities are tiny (dozens) and tiers few, a DP over quantity (`0..N`) that, for each state, tries every tier and the single step, is instant and exact. Pack pricing under go-highest is resolved by sorting breads by their pack-tier price descending and filling packs greedily with the most expensive first (proven-optimal for "each pack = max of its members" because concentrating maxima minimizes the number of packs paying a high rate). **The allocator will be cross-checked against a brute-force reference in tests.**

### `computeOrderPricing(input): OrderPricing`
```ts
input: {
  lines: { breadTypeId; breadSizeId | null; quantity; unitPrice; hasAdditions }[];
  tiersBySize: Map<breadSizeId, { default: Tier[]; byType: Map<typeId, Tier[]> }>;
  surcharge: number;
  dealsEnabled: boolean;
  deliveryFee: number;
  totalOverride: number | null;
}
returns: { goods: number; deliveryFee: number; total: number; rows: Allocation[] }
```
- Expand lines into per-unit `PricedUnit`s, grouped by size.
- For each size: if `dealsEnabled` and the size has tiers → `allocateSize`; else sum singles (+surcharge).
- Lines with a null size or a non-bundleable size → plain `quantity × (unitPrice + surcharge?)`.
- `goods` = Σ size groups. `total` = `totalOverride ?? goods` `+ deliveryFee`. (Delivery fee always added consistently — this standardizes the 5 divergent copies and fixes the PATCH-drops-fee bug.)

### Write-time helper
A thin DB-facing wrapper (in a route or `src/lib/order-pricing.ts`) that loads tiers + surcharge for a group, calls `computeOrderPricing`, and returns `goods` + `rows` to snapshot onto the order. Read paths prefer `order.goodsSnapshot` when present, falling back to a live compute for legacy rows without a snapshot.

## Behavior-preserving migration of the 5 rollups

Replace each duplicated `totalOverride ?? Σ(qty×pricePerUnit) [+fee]` with a call that yields the same number when no snapshot/tiers exist:
- `src/lib/order-payments.ts` `calculateOrderTotal`
- `src/app/api/orders/[id]/route.ts` GET (`calculatedTotal`/`totalPrice`) and PATCH (currently drops fee — now fixed)
- `src/app/api/payments/route.ts`
- `src/app/api/deliveries/route.ts` (SQL sum → prefer `goodsSnapshot` when set)
- `src/app/api/orders/route.ts` create (now also snapshots)

For orders with a `goodsSnapshot`, goods = snapshot. For legacy orders (null snapshot), goods = Σ(qty×pricePerUnit) — identical to today. Delivery fee + override handling is unified.

## UI

### Catalog editor (`/miniapp/settings/catalog`)
Per (type, size) row, an optional **tiers** editor: a small list of `qty → ₪price` rows the owner can add/remove. Default tiers set on the size; per-type rows override. Copy: e.g. "מבצע כמות: 6 → ₪40". Icon-button add/remove per the design prefs.

### Order form (`/miniapp/orders/new`)
- Add a **"החל מבצעים"** (apply deals) toggle, default on, sent as `dealsEnabled`.
- The live total is computed by the **same** `computeOrderPricing` (client import of the pure module) from catalog tiers, so the owner sees the deal price and breakdown before saving.

### Order detail (`/miniapp/orders/[id]`)
- Render `pricingBreakdown` rows when present (the "6-pack @₪45 · 1 single @₪8" lines) above the total. Fall back to the current per-line display for legacy orders.
- Existing custom-total (`totalOverride`) editor unchanged; still wins.

## Migration & retirement of "six buns"

The schema migration is **additive** (new table + new columns; non-destructive). Existing "six buns" sizes keep working as ordinary sizes until the owner acts. Post-deploy, the owner (guided in the ping):
1. On each bread's **bun** size, add a `6 → <its six price>` tier (default + per-type overrides), using the new catalog UI.
2. Deactivate the "six buns" size.
Because past orders are snapshotted (or fall back to line snapshots), none of this changes historical totals.

## Testing

- `src/lib/pricing.ts` unit tests (`npx tsx`): singles-only (inert) equals plain sum; single-tier; multi-tier cheapest-combination incl. the greedy-trap case; go-highest mixed packs; concentrate-premium; leftovers-cheapest; additions surcharge on top; **brute-force cross-check** of `allocateSize` for randomized small inputs.
- `npx tsc --noEmit`, `npx next build`.
- Headless-Chrome screenshots of the catalog tier editor, order form with a deal applied, and order detail breakdown.

## Out of scope (YAGNI)

Per-line price override; tier combine strategies beyond go-highest; auto-deletion of the six-buns size; multi-currency; customer-facing self-service.
