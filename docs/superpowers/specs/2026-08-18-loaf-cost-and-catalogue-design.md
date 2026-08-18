# Loaf Cost Calculator + Catalogue Revamp — Design

**Date:** 2026-08-18
**Status:** approved, both parts to build

Two connected pieces of work. Part 1 adds a cost model the app has never had.
Part 2 fixes the two things the owner named about the catalogue: you cannot
tell what is saved, and the bread sheet is too long.

---

## Baseline — what is actually there

A read-only census of production on 2026-08-18:

- **1 of 15 bread types has a recipe.** `כפרי` (id 9), five rows. The other
  fourteen have zero ingredients. The calculator therefore produces a number
  for one bread on day one; the copy-recipe flow shipped 2026-08-16 is what
  closes that gap.
- **Five ingredient names exist in total** — `קמח לבן`, `קמח מלא` (flour),
  `מים` (water), `מלח` (salt), `מחמצת` (starter). All distinct, no
  near-duplicates.
- **Eight bread sizes**, of which `בינוני` (id 17) has `weight_grams = NULL`,
  so no recipe can scale to it.
- **Twelve additions** (`זיתים`, `אגוזי מלך`, `חמוציות`…) carrying **no weight
  anywhere** — `bread_additions` is name + isDefault + isActive + sortOrder.
- **Zero cost/margin concept** in the schema, in `src/lib/i18n.ts`, or
  anywhere else. `cost` in `src/lib/pricing.ts` is the DP objective function in
  agorot *charged*, not an expense.

## Decisions taken by the owner

| Question | Decision |
|---|---|
| Additions | **Out of scope.** Cost is dough only; every surface says `לא כולל תוספות`. |
| Price entry | **₪ per kilo, typed directly.** No package-size arithmetic. |
| Output | **Cost per loaf and ₪ per kilo.** No sale price, no margin. |
| Cost scope | **Ingredients only.** No packaging, no labour, no overhead. |
| Starter | **Derived** from a separately chosen flour + water, times a waste factor. |
| Placement | **Its own screen** under the catalog, not a 4th accordion, not a 5th tab. |
| Revamp targets | **"Can't tell what's saved"** and **"the sheet is too long"**. Not tap count, not the size list. |
| Revamp approach | **A — honest sections** (per-section save, made visible), not one sticky save. |

---

# Part 1 — Loaf cost calculator

## 1.1 Why the arithmetic is already free

`bread_recipe_ingredients.pct_of_finished` is **grams per 100 g of finished
(baked) loaf**, chosen deliberately in `7096f9a` ("no absolute anchors").
`src/lib/recipe.ts:104` is the whole scaling rule:

```ts
grams: (i.pctOfFinished * targetFinishedGrams) / 100,
```

Bake loss is already implicit in the sum — `כפרי` sums to 105.1111 %, i.e. 946 g
of dough per 900 g loaf. **The grams this yields are raw purchased grams.**
Applying any yield factor on top would double-count. No recipe schema change is
needed for costing.

Precision available is `numeric(7,4)` = 0.001 g on a 1 kg loaf. Cost must be
computed off unrounded `ScaledIngredient.grams`, never off the rounded integer
the UI displays (`recipe.ts:231`, `RecipeEditor.tsx:541`).

## 1.2 Data model

### New table

```ts
// What a kilo of each ingredient costs, per group.
//
// Keyed on (name, kind) rather than an ingredient id because recipe rows carry
// no id: bread_recipe_ingredients.name is free text, and sumScaledByType
// (src/lib/recipe.ts:144) already aggregates on that same `name|kind` pair.
// Carries group_id directly — unlike the recipe tables it has no bread-type
// parent to inherit tenancy from, which is also what lets withGroup serve it.
export const ingredientPrices = pgTable(
  'ingredient_prices',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id').notNull().references(() => groups.id),
    name: varchar('name', { length: 100 }).notNull(),
    kind: ingredientKindEnum('kind').notNull(),
    // Shekels per kilogram. Recipes scale to grams, so per-kg divides cleanly.
    pricePerKg: decimal('price_per_kg', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ingredient_prices_group_name_kind_idx').on(
      table.groupId, table.name, table.kind
    ),
  ]
);
```

No `is_active`, no `sort_order`: the list the owner edits is derived from the
ingredients actually present in recipes, ordered by `KIND_DISPLAY_ORDER`.

### New columns on `groups`

```ts
// מחמצת is not bought — it is fed from a flour the baker chooses, at a
// hydration, and a portion is discarded between feeds. Three numbers, set once,
// price every starter in the bakery.
starterFlourName: varchar('starter_flour_name', { length: 100 }),
starterHydrationPct: integer('starter_hydration_pct').notNull().default(100),
starterWasteFactor: decimal('starter_waste_factor', { precision: 4, scale: 2 })
  .notNull().default('1.50'),
```

`starterFlourName` is nullable: until the owner picks a flour, starter is
unpriced and says so.

### Why `(name, kind)` and not an ingredient master table

Five ingredient names exist. A master table with an `ingredient_id` FK on
`bread_recipe_ingredients` is the right answer for a catalogue of fifty; for
five it is a hand-authored data migration over live production rows with no
test suite, to fix a problem that has not occurred.

The risk it leaves open is real: `IngredientNameInput` is a `<datalist>`,
deliberately non-constraining, so a typo silently mints a new ingredient
identity and forks its price key. **Mitigation:** the costs screen lists any
saved price whose name matches no recipe row under `לא בשימוש`. A fork becomes
visible the day it happens rather than six months later.

### Migration

Hand-authored `drizzle/0025_ingredient_prices.sql` + a `_journal.json` entry
with `when` **strictly greater than 1786916109750** (0024's) — the neon-http
migrator compares `lastDbMigration.created_at < migration.folderMillis` and
never compares hashes.

`npm run db:generate` must **not** be run: `drizzle/meta/` snapshots froze at
`0010` and do not contain `bread_size_tiers`, `bread_recipe_ingredients`,
`customer_phones` or `media_assets`. A plain generate would emit a migration
re-creating ~14 tables. Migrations `0011`–`0024` were all hand-authored.

## 1.3 The math — `src/lib/cost.ts`

Pure, no DB imports, mirroring `src/lib/pricing.ts` (275 lines, zero imports).

```ts
export interface PriceBook {
  /** ₪/kg keyed `name|kind`. Absent key = no price. 0 is a real price. */
  pricePerKg: Record<string, number>;
  starter: {
    flourName: string | null;
    hydrationPct: number;
    wasteFactor: number;
  };
}

export interface CostedIngredient {
  name: string;
  kind: IngredientKind;
  grams: number;
  pricePerKg: number | null;   // null = no price row
  cost: number | null;
  derived: boolean;            // true for starter
}

export interface LoafCost {
  finishedGrams: number;
  total: number;               // ₪ — priced ingredients only
  perKg: number;               // ₪ per kg of finished bread
  ingredients: CostedIngredient[];
  unpriced: { name: string; kind: IngredientKind }[];
  complete: boolean;           // unpriced.length === 0
}

export function costScaledRecipe(scaled: ScaledRecipe, book: PriceBook): LoafCost;
export function starterPricePerKg(book: PriceBook): number | null;
```

### Starter derivation

The owner picks the flour explicitly; it is **not** inferred from the recipe.
One global number, used by every recipe:

```
flourShare = 100 / (100 + hydrationPct)
waterShare = hydrationPct / (100 + hydrationPct)
starter ₪/kg = (flourShare × price(starterFlourName)
              + waterShare × waterPrice) × wasteFactor
```

- `waterPrice` is the price of the **cheapest** `water`-kind row in the book,
  or `0` when the book has no water row at all. Water is the one ingredient
  whose true price is usually zero, and refusing to cost a loaf because nobody
  typed `0` for tap water would be obtuse.
- If `starterFlourName` is null, or names a flour with no price row, every
  starter ingredient is **unpriced** — never silently zero.

### Worked example (`כפרי`, 900 g, ₪5 white / ₪6 whole / ₪0 water / ₪2 salt, starter flour = `קמח לבן`, hydration 100, waste ×1.5)

| | pct | grams | ₪/kg | ₪ |
|---|---|---|---|---|
| קמח לבן | 27.7778 | 250.0 | 5.00 | 1.25 |
| קמח מלא | 27.7778 | 250.0 | 6.00 | 1.50 |
| מים | 37.2222 | 335.0 | 0.00 | 0.00 |
| מלח | 1.2222 | 11.0 | 2.00 | 0.02 |
| מחמצת | 11.1111 | 100.0 | 3.75 *derived* | 0.38 |
| **סה״כ** | 105.1111 | **946 g dough** | | **₪3.15 · ₪3.50/ק״ג** |

Derived starter: `(0.5 × 5.00 + 0.5 × 0.00) × 1.5 = ₪3.75/kg`.

### An unpriced ingredient is never ₪0

The codebase's own principle, `src/lib/order-recipe.ts:41-45`: *"a recipe block
that quietly omits a bread reads as 'nothing else to mix'"*. `unpriced` is
returned explicitly and every surface renders it. A price of `0` typed by the
owner is a real price and leaves the loaf `complete`.

## 1.4 Where the math is NOT

**Cost does not enter `computeOrderPricing`.** `OrderPricing`
(`pricing.ts:216`) is `{goods, deliveryFee, total, rows}` and is consumed **on
the client** at `src/app/miniapp/orders/new/page.tsx:341`. Adding cost there
would push ingredient prices into the browser bundle and into
`/api/bread-types`, and would put a non-charged number one typo away from
`goods`. `AGENTS.md`'s single-bulk-pricing-engine rule governs what is
*charged*; cost is orthogonal.

## 1.5 DB wrapper — `src/lib/ingredient-costs.ts`

Shaped like `loadGroupTiers` (`order-pricing.ts:20-59`):

```ts
export async function loadPriceBook(groupId: number): Promise<PriceBook>;
export async function loadIngredientsInUse(groupId: number): Promise<InUseIngredient[]>;
```

`loadIngredientsInUse` reads every `(name, kind)` from
`bread_recipe_ingredients` joined to `bread_types` of this group **without an
`isActive` filter**. `GET /api/recipes:19` filters to active types, but
`aggregateRecipesForOrders` (`order-recipe.ts:67`) does not — a deactivated
bread sitting on a live order still needs costing, so its ingredients must
appear in the price list.

## 1.6 API — `src/app/api/ingredient-prices/route.ts`

`withGroup`, then **server-side role gate**: `baker` and `driver` get 403,
following `src/app/api/groups/[id]/bread-sizes/route.ts:37-40`. Not a client
`{!isBaker && …}` guard — sixteen of those already exist in the catalogue page
and every one of them ships the data to the browser anyway.

**GET** → everything the screen needs in one call:

```jsonc
{
  "prices":  [{ "name": "קמח לבן", "kind": "flour", "pricePerKg": "5.00" }],
  "inUse":   [{ "name": "קמח לבן", "kind": "flour", "usedBy": ["כפרי"] }],
  "starter": { "flourName": "קמח לבן", "hydrationPct": 100, "wasteFactor": "1.50" },
  "loaves":  [{ "breadTypeId": 9, "breadTypeName": "כפרי",
                "sizes": [{ "sizeId": 2, "sizeName": "כיכר משפחתי",
                            "weightGrams": 900, "total": 3.15, "perKg": 3.5,
                            "unpriced": [] }],
                "noRecipe": false,
                "sizesMissingWeight": ["בינוני"] }]
}
```

`loaves` is computed **server-side** so the cost table is one fetch and the
client never needs the recipe rows.

**PUT** — the whole book plus starter settings, in **one statement**, since
neon-http has no interactive transactions. Same data-modifying-CTE trick as the
recipe write (`bread-types/[id]/recipe/route.ts`):

```sql
WITH g AS (UPDATE groups SET starter_flour_name = $1, ... WHERE id = $n),
     cleared AS (DELETE FROM ingredient_prices WHERE group_id = $n)
INSERT INTO ingredient_prices (group_id, name, kind, price_per_kg)
VALUES ...
```

Empty price list takes the branch without the INSERT (a bare `UPDATE` + `DELETE`
CTE). Validation: `name` 1..100 after trim, `kind` in the enum, `pricePerKg`
`/^\d+(\.\d{1,2})?$/`, no duplicate `(name, kind)` pairs, hydration 1..500,
waste 1.00..10.00.

No `revalidatePublicSite` — cost is internal and appears on no public surface.

## 1.7 The screen — `/miniapp/settings/costs`

Title `מחירי חומרי גלם`. Reached from a row at the top of `קטלוג`, hidden for
bakers and drivers. Own route, own back button, own file. One `שמור`.

1. **המחירים** — every `(name, kind)` in use, grouped by
   `KIND_DISPLAY_ORDER`, each with a ₪/kg field. Starter rows are read-only and
   show their derived value with a `מחושב` hint. Saved prices whose name is in
   no recipe appear under `לא בשימוש` with a delete affordance.
2. **מחמצת** — flour picker (a `<select>` over the flour names in use),
   hydration %, waste ×. Shows the resulting ₪/kg live.
3. **עלות לכיכר** — for every bread × size with a weight: cost per loaf and
   ₪/kg. `אין מתכון` where the bread has none, `חסר משקל` for sizes like
   `בינוני`, `חסר מחיר: קמח מלא` where a price is missing. Footer:
   `לא כולל תוספות`.

Empty state (no recipes at all): a line explaining that costs need recipes,
with a link to `קטלוג`.

## 1.8 Cost in the bread sheet

One line inside the existing recipe block — `עלות ₪3.15 · ₪3.50/ק״ג` at the
sheet's reference weight — not a new section, because the owner's complaint is
that the sheet is already too long. `!isBaker`, and the data comes from the
role-gated endpoint, so a baker's browser never receives it.

---

# Part 2 — Catalogue revamp (approach A)

Scope is bounded by the owner's two complaints. **The size list is explicitly
out of scope** (`בינוני`'s missing weight, the three 900 g sizes) — it was
offered and not selected. So is tap count.

## 2.1 The problem, precisely

`src/app/miniapp/settings/catalog/page.tsx` is 1579 lines, 45 `useState`, 33
`apiFetch` sites, 8 local interfaces, plus a private `TierEditor` component at
`:1480-1579`. The bread sheet it renders has **three different save
behaviours at once**:

| Block | Commits when |
|---|---|
| name, sizes, prices, badges, additions | the bottom `שמור` (`:1456`) |
| tier overrides | **on blur** (`TierOverrideEditor.tsx:116-124`) |
| recipe | its own button (`RecipeEditor.tsx:280`) |

Backing out of the sheet discards the first and keeps the other two, with
nothing on screen saying so. And the sheet renders name, badges, an image
picker, the whole recipe editor, size chips, tier overrides, **one badge picker
per enabled size**, additions, save and delete in a single scroll.

## 2.2 The fix — one rule, made visible

**Every block becomes a `SectionCard`:** a title, a collapse chevron, a dirty
dot, and a `שמור` that **appears only when that section is dirty**. Uniformly —
including the recipe, and including tier overrides, whose save-on-blur is
deleted. The learnable rule is *"if a שמור is showing, something is unsaved"*.

Leaving the sheet with anything dirty asks first, naming the sections.

Sections collapse; only `פרטים` is open on entry. A four-size bread stops
rendering five badge pickers in one scroll.

### Why not one sticky save for the whole sheet

It would be a lie. Four sequential HTTP writes, no transaction, and the sizes
PUT is destructive server-side
(`bread-types/[typeId]/sizes/route.ts:63-77` deletes all junction rows then
re-inserts). `saveType` (`page.tsx:545-616`) already has this bug with three
writes: a network drop mid-save leaves a bread with **zero enabled sizes**,
which every read surface renders as unconfigured and which silently removes it
from the public pricelist. A single save button would make that four writes and
hide the seam rather than fix it.

## 2.3 File structure

```
src/app/miniapp/settings/catalog/page.tsx     ← list + the two global accordions only
src/components/catalog/BreadSheet.tsx         ← the overlay shell, dirty tracking, exit guard
src/components/catalog/SectionCard.tsx        ← title + collapse + dirty dot + conditional save
src/components/catalog/sections/DetailsSection.tsx
src/components/catalog/sections/RecipeSection.tsx     ← wraps RecipeEditor + the cost line
src/components/catalog/sections/SizesSection.tsx      ← size chips, prices, tier overrides
src/components/catalog/sections/AdditionsSection.tsx
src/components/catalog/sections/BrandingSection.tsx   ← type badge + image + per-size badges
```

`SectionCard` owns the interaction contract; each section owns its own draft
state, its own endpoint, and its own save. Sections communicate with the shell
only through `onDirtyChange(sectionKey, dirty)`.

## 2.4 Incidental fixes taken on the way

Only what the work touches:

- **`effectivePrice(size, link)`** in `src/lib/pricing.ts` — the
  `priceOverride ?? price` rule is duplicated at 12 sites in 7 files with no
  helper. The sections would add a 13th. Introduce it and use it in the files
  this work opens; leave the rest for the caller that next touches them.
- **Hardcoded Hebrew** in the strings this work moves: `'הלחם נשמר'` (`:612`),
  the `window.confirm` at `:1464`, `{n} גדלים` (`:1170`), `aria-label="חזרה"`.
- **Wrong error keys:** `t('settings.delete_failed')` (*"can't delete — in use
  by orders"*) is used for a bad surcharge **format** at `:283` and `:295`, and
  `saveType`'s catch borrows `t('customers.save_failed')` (`:614`).
- **The unconditional `GET /recipes` on every sheet open**
  (`RecipeEditor.tsx:134-147`) fetches every recipe and every ingredient name
  in the group whether or not the copy flow is ever used. Defer it to first
  need.

Explicitly **not** taken on: the size catalogue, the two tier editors' merge,
the three copy-pasted reorder functions, the six ungated GET handlers that hand
bakers sell prices, `orders/new/page.tsx:853`'s hand-rolled duplicate of the
total rule. Real, but not this job.

## 2.5 Blast radius

Part 2 is UI-only. No schema change, no endpoint contract change, no change to
`order-lines.ts`, `pricing.ts`'s pooling, `public-site.ts`, `catalog-export.ts`,
or any bot/print/WhatsApp surface. `revalidatePublicSite` call sites are
untouched because the routes they live in are untouched.

---

## Verification

There is no test runner. The gate is:

```
npx tsc --noEmit && npx next build
```

**Never `npm run build`** — `package.json:7` is
`tsx scripts/migrate.ts && next build`, which migrates production first.

Beyond the gate: the cost math is exercised against the real `כפרי` recipe with
forged Telegram init-data (HMAC-signed with `TELEGRAM_BOT_TOKEN`), and both
screens are driven headlessly in Chrome with an injected
`window.Telegram.WebApp`. Any production row written during testing is restored.
