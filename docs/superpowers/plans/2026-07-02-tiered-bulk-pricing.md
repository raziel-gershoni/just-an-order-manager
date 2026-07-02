# Tiered Bulk-Pricing Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bundle-as-size modeling with a reusable, per-bread, multi-tier bulk-pricing engine that charges the cheapest combination of tiers + singles for any quantity and mix, with a per-order deals-off switch — inert until the owner defines tiers.

**Architecture:** One pure pricing module (`src/lib/pricing.ts`) is the single source of truth; a thin DB wrapper (`src/lib/order-pricing.ts`) loads tiers and calls it. New `bread_size_tiers` table (null bread = size default, set bread = per-type override) plus `orders.dealsEnabled/goodsSnapshot/pricingBreakdown`. All 5 duplicated total rollups are replaced by the module; orders snapshot their computed goods so placed orders never re-price.

**Tech Stack:** Next.js 16 App Router, React 19, drizzle-orm + Neon Postgres, zod/v4, Tailwind v4.

## Global Constraints

- **Inert until configured:** with zero tiers and `dealsEnabled=true`, every order prices exactly as today (Σ qty×pricePerUnit). Verified by test.
- **Additive migration only:** new table + new nullable/defaulted columns; no destructive change; migrations auto-run on Vercel deploy (`npm run db:generate` to author, committed SQL applied on build).
- **Do not auto-delete the "six buns" size.** Owner folds it into a tier and retires it manually post-deploy.
- **Money-safe:** delivery-fee + `totalOverride` handling unified across all read sites; PATCH must stop dropping the fee.
- Verification: `npx tsc --noEmit`, `npx next build`, `npx tsx` unit tests (incl. brute-force allocator cross-check), headless-Chrome screenshots. No jest/vitest runner exists.
- Hebrew/RTL only; use `t()` i18n keys; follow existing DOCKET UI patterns and design prefs (icon buttons, flex gap).

---

## File structure

| File | Responsibility |
|---|---|
| `src/db/schema.ts` (modify) | `breadSizeTiers` table; `orders.dealsEnabled/goodsSnapshot/pricingBreakdown` |
| `drizzle/00NN_*.sql` (generated) | additive migration |
| `src/lib/pricing.ts` (create) | pure engine: `allocateSize`, `computeOrderPricing`, types |
| `scripts/pricing.test.ts` (create, scratchpad) | tsx unit + brute-force tests |
| `src/lib/order-pricing.ts` (create) | DB wrapper: load tiers for a group, compute, return goods+rows |
| `src/lib/order-payments.ts` (modify) | `calculateOrderTotal` → prefer snapshot / module |
| `src/app/api/orders/route.ts` (modify) | POST: accept `dealsEnabled`, snapshot goods+breakdown |
| `src/app/api/orders/[id]/route.ts` (modify) | GET/PATCH: use module; fix PATCH fee drop; re-snapshot on edit |
| `src/app/api/payments/route.ts` (modify) | use module/snapshot |
| `src/app/api/deliveries/route.ts` (modify) | prefer `goodsSnapshot` |
| `src/app/api/bread-types/route.ts` (modify) | expose tiers per (type,size) to the form |
| `src/app/api/bread-size-tiers/route.ts` (create) | CRUD for tiers (catalog editor) |
| `src/app/miniapp/settings/catalog/*` (modify) | tier editor UI per (type,size) |
| `src/app/miniapp/orders/new/page.tsx` (modify) | deals-off toggle; live total via module |
| `src/app/miniapp/orders/[id]/page.tsx` (modify) | render `pricingBreakdown` |
| `src/lib/i18n.ts` (modify) | new Hebrew keys |

---

## Phase 1 — Pricing module (pure, TDD)

### Task 1: Types + `allocateSize` (singles + single-tier)

**Files:** Create `src/lib/pricing.ts`, `scripts/pricing.test.ts` (in scratchpad).

**Produces:**
```ts
export type Tier = { minQty: number; price: number };           // price = TOTAL for minQty units
export type PricedUnit = { breadTypeId: number; unitPrice: number; hasAdditions: boolean };
export type SizeGroup = { breadSizeId: number; tiers: Tier[]; units: PricedUnit[]; sizeName: string };
export type Allocation = { label: string; amount: number };
export function allocateSize(group: SizeGroup, surcharge: number): { total: number; rows: Allocation[] };
```

Algorithm for `allocateSize`:
1. `n = units.length`. Surcharge add-on `= surcharge × units.filter(hasAdditions).length`, computed separately and added to the final total (never affects the cover).
2. Base unit prices sorted **descending** → `p[0..n-1]`. Singles cost = each unit's own `unitPrice`.
3. If `tiers` empty → base = Σ unitPrice; rows = one per bread grouping (or a single "×n" row). Return base+addon.
4. Else min-cost cover via DP over `k = 0..n` items *by count*, where forming a pack of `minQty` from the **most-expensive-remaining** units costs `tier.price` (go-highest is automatically the max because we always take the top slice). `dp[k]` = min cost to cover the `k` most-expensive units. Transition: `dp[k] = min( dp[k-1] + p[k-1] /*single*/, min over tiers with minQty≤k of dp[k-minQty] + tier.price )`. Reconstruct to produce rows. Add-on added after.

- [ ] Write failing tests: inert (no tiers) equals Σ; single tier 6→40 on 6 identical → 40; on 7 → 40+single; surcharge added on top.
- [ ] Implement; run `npx tsx scripts/pricing.test.ts` → PASS.
- [ ] Commit.

### Task 2: multi-tier cheapest-combination + brute-force cross-check

**Consumes:** `allocateSize`.

- [ ] Add tests: tiers {4→30, 6→48}, n=8 → 60 (two 4-packs), NOT 68. tiers {6→40,30→150}, n=37 → 198. Greedy-trap asserted.
- [ ] Add `bruteForceAllocate(prices:number[], tiers:Tier[])` reference (exhaustive recursion) in the test file; randomly generate 300 cases (n≤14, 0–3 tiers) and assert `allocateSize` total === brute force total.
- [ ] Run → PASS. Commit.

### Task 3: go-highest across breads + concentrate-premium + breakdown rows

**Consumes:** `allocateSize`.

- [ ] Tests: units of white(tier 6→40) + spelt(6→45) — a mixed six charges 45; 2 spelt+10 white into two sixes → 45+40=85 (spelt concentrated), not 90; leftovers are the cheapest breads at their single price; `rows` labels reflect pack size and count.
- [ ] Extend implementation so per-type tier prices are honored: each `PricedUnit` carries its own tier price for the size (passed via `SizeGroup` or resolved by caller). Simplest: caller expands units already carrying `unitPrice` (single) and the size's effective tiers are per group; for go-highest, the pack price = max over the units in the pack of that unit's **pack tier price at that minQty**. Store per-unit tier prices on `PricedUnit` as `tierPrice: Map<minQty, number>`; the top-slice construction guarantees max. Update DP to read the max tier price of the top slice.
- [ ] Run → PASS. Commit.

### Task 4: `computeOrderPricing`

**Produces:**
```ts
export type OrderPricingInput = {
  lines: { breadTypeId: number; breadSizeId: number | null; quantity: number; unitPrice: number; hasAdditions: boolean;
           tierPrices: Record<number, number> /* minQty→price, effective for this type+size */ }[];
  surcharge: number; dealsEnabled: boolean; deliveryFee: number; totalOverride: number | null;
};
export type OrderPricing = { goods: number; deliveryFee: number; total: number; rows: Allocation[] };
export function computeOrderPricing(input: OrderPricingInput): OrderPricing;
```
- Expand lines → `PricedUnit`s grouped by `breadSizeId` (skip null-size lines → plain qty×(unit+surcharge?)).
- Per size: `dealsEnabled && size has any tier` → `allocateSize`; else plain singles.
- `goods = Σ`; `total = (totalOverride ?? goods) + deliveryFee`.
- [ ] Tests: dealsEnabled=false → plain singles even with tiers; totalOverride wins; fee always added; null-size line handled.
- [ ] Run → PASS. Commit.

---

## Phase 2 — Schema + migration (additive)

### Task 5: `breadSizeTiers` + order columns

**Files:** Modify `src/db/schema.ts`.
```ts
export const breadSizeTiers = pgTable('bread_size_tiers', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id').notNull().references(() => groups.id),
  breadSizeId: integer('bread_size_id').notNull().references(() => breadSizes.id),
  breadTypeId: integer('bread_type_id').references(() => breadTypes.id), // null = size default
  minQty: integer('min_qty').notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [unique().on(t.breadSizeId, t.breadTypeId, t.minQty)]);
```
Add to `orders`: `dealsEnabled: boolean('deals_enabled').notNull().default(true)`, `goodsSnapshot: decimal('goods_snapshot',{precision:10,scale:2})`, `pricingBreakdown: jsonb('pricing_breakdown')`.
- [ ] Edit schema; `npm run db:generate`; inspect generated SQL is additive (CREATE TABLE + ADD COLUMN, no drops).
- [ ] `npx tsc --noEmit`. Commit schema + migration.

---

## Phase 3 — DB wrapper + wire read/write sites (behavior-preserving)

### Task 6: `src/lib/order-pricing.ts`
Loads `additionsSurcharge`, effective tiers per (type,size) for a group, maps order lines → `OrderPricingInput`, calls `computeOrderPricing`. Export `priceOrderForWrite(groupId, lines, {dealsEnabled, deliveryFee, totalOverride})` → `{ goods, rows, total }`, and `goodsForRead(order, items)` → prefer `order.goodsSnapshot ?? Σ(qty×pricePerUnit)`.
- [ ] Implement; unit-check tiers resolution (default vs per-type) with a tsx test using a fake tier set.
- [ ] Commit.

### Task 7: order create — snapshot
`src/app/api/orders/route.ts`: accept `dealsEnabled` (zod bool default true); after building items, call `priceOrderForWrite`; store `dealsEnabled`, `goodsSnapshot=goods`, `pricingBreakdown=rows`. Keep per-line `pricePerUnit` snapshot as today (single price).
- [ ] Verify with no tiers goods === old Σ. Commit.

### Task 8: order GET/PATCH — module + fee fix + re-snapshot
`src/app/api/orders/[id]/route.ts`: GET uses `goodsForRead`; `totalPrice = (totalOverride ?? goods) + fee`. PATCH recomputes items, re-snapshots goods/breakdown, and returns `totalPrice` **with fee** (fixes the drop). Accept `dealsEnabled` on PATCH.
- [ ] Commit.

### Task 9: payments + deliveries + order-payments
`payments/route.ts`, `deliveries/route.ts`, `order-payments.ts`: replace inline rollups with `goodsForRead`/`calculateOrderTotal` unified (fee always added; snapshot preferred). 
- [ ] Verify charge amounts unchanged for legacy orders. Commit.

---

## Phase 4 — Tier CRUD + catalog UI

### Task 10: `src/app/api/bread-size-tiers/route.ts` (+ `[id]`)
POST `{ breadSizeId, breadTypeId|null, minQty, price }` (group-scoped, manager/owner only, upsert on unique); DELETE by id; GET tiers for the group. Zod-validated; `minQty ≥ 2`, price decimal.
- [ ] Commit.

### Task 11: catalog tier editor
In the size/`breadTypeSizes` editor under `/miniapp/settings/catalog`, add a compact tiers list per (type,size): rows of `qty → ₪` with add/remove icon buttons; a null-type "default" set at the size level. Wire to the tier API. Hebrew copy: `catalog.tiers`, `catalog.tier_add`, `catalog.tier_qty`, `catalog.tier_price`.
- [ ] Screenshot verify. Commit.

---

## Phase 5 — Order form + detail

### Task 12: `bread-types` route exposes tiers
`src/app/api/bread-types/route.ts`: include effective `tiers` (default+override merged) per (type,size) so the client can compute live.
- [ ] Commit.

### Task 13: order form deals toggle + live total
`src/app/miniapp/orders/new/page.tsx`: add "החל מבצעים" toggle (default on) → `dealsEnabled` in payload; replace `liveTotal` reducer with a call to `computeOrderPricing` (import the pure module client-side) using catalog tiers; show breakdown lines.
- [ ] Screenshot verify (with a deal). Commit.

### Task 14: order detail breakdown
`src/app/miniapp/orders/[id]/page.tsx`: when `pricingBreakdown` present, render rows above the total; else legacy per-line view. Keep custom-total editor.
- [ ] Screenshot verify. Commit.

---

## Phase 6 — Verify + push

### Task 15: full verification
- [ ] `npx tsc --noEmit`; `npx next build`; re-run `scripts/pricing.test.ts`.
- [ ] Manual scenario matrix via a tsx harness mimicking real order shapes (inert equals legacy; a bun deal mix; deals-off).
- [ ] Adversarial review workflow over the allocator + all 6 pricing sites for consistency.
- [ ] Push; ping owner with the post-deploy tier-setup + six-buns retirement steps.
