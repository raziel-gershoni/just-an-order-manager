# Loaf Cost Calculator + Catalogue Revamp — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the owner a ₪/kg ingredient price book and a cost-per-loaf
readout, and make the bread sheet's save behaviour visible and its length
manageable.

**Architecture:** A pure `src/lib/cost.ts` computes cost from an already-scaled
recipe and a price book; a thin DB wrapper loads the book; one role-gated
route serves both the editor and the computed cost table. The catalogue page
splits into a list page plus a `BreadSheet` composed of `SectionCard`s, each
owning its own draft state, endpoint and save button.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM,
Neon Postgres over neon-http.

## Global Constraints

- **No interactive transactions.** neon-http only. Multi-row atomicity must be
  one SQL statement via a data-modifying CTE.
- **Verification gate is `npx tsc --noEmit && npx next build`.** There is no
  test runner. **Never run `npm run build`** — it migrates production first.
- **Never run `npm run db:generate`.** `drizzle/meta/` snapshots froze at
  `0010`; hand-author the migration and the `_journal.json` entry, `when` >
  `1786916109750`.
- All order **pricing** stays in the single bulk-pricing engine. Cost is
  orthogonal and must not enter `computeOrderPricing`.
- Cost is **owner/manager only**, enforced server-side (403), not by client JSX.
- Hebrew/RTL only. New strings go in `src/lib/i18n.ts`; numbers render
  `tabular-nums` and LTR-isolated.
- Unpriced ingredients are **never** treated as ₪0.
- Cost excludes additions; every cost surface says `לא כולל תוספות`.

---

### Task 1: Schema + migration

**Files:**
- Modify: `src/db/schema.ts` (add `ingredientPrices`; 3 columns on `groups`)
- Create: `drizzle/0025_ingredient_prices.sql`
- Modify: `drizzle/meta/_journal.json`

- [x] **Step 1:** Add three columns to `groups` after `recurringRemindersEnabled`:
      `starterFlourName varchar(100)` nullable,
      `starterHydrationPct integer notNull default 100`,
      `starterWasteFactor decimal(4,2) notNull default '1.50'`, with a comment
      explaining that starter is fed, not bought.
- [x] **Step 2:** Add `ingredientPrices` after `breadRecipeIngredients`, exactly
      as drafted in the spec §1.2, with the `(group_id, name, kind)` unique index.
- [x] **Step 3:** Hand-write `drizzle/0025_ingredient_prices.sql` in the style of
      `0017_tiered_pricing.sql`: tab-indented columns, `--> statement-breakpoint`
      separators, fully-qualified `"public"."groups"` in the FK, and the enum
      typed as `"public"."ingredient_kind"`. Use `ADD COLUMN IF NOT EXISTS` for
      the `groups` columns.
- [x] **Step 4:** Append the journal entry `{idx: 25, version: "7", when:
      1787002509750, tag: "0025_ingredient_prices", breakpoints: true}`.
- [x] **Step 5:** `npx tsc --noEmit`. Expected: clean.
- [x] **Step 6:** Applied with `npx tsx scripts/migrate.ts`. There is only one
      database — `DATABASE_URL` in `.env.local` is production — so the choice was
      between applying it through the migrator (which records it, keeping the
      Vercel deploy a no-op) or hand-running the SQL and leaving the deploy to
      fail on "table already exists". The migration is purely additive and
      `IF NOT EXISTS`-guarded. Verified via `information_schema.columns`.
- [x] **Step 7:** Commit `feat(cost): ingredient_prices table + starter settings`.

---

### Task 2: `src/lib/cost.ts` — the pure math

**Files:**
- Create: `src/lib/cost.ts`

**Interfaces:**
- Consumes: `ScaledRecipe`, `ScaledIngredient`, `IngredientKind` from `@/lib/recipe`.
- Produces: `PriceBook`, `CostedIngredient`, `LoafCost`, `priceKey()`,
  `starterPricePerKg()`, `costScaledRecipe()`.

- [x] **Step 1:** Write `priceKey(name, kind) => \`${name}|${kind}\`` — the same
      key `sumScaledByType` (`recipe.ts:144`) already aggregates on.
- [x] **Step 2:** Write `starterPricePerKg(book): number | null`.
      `flourShare = 100/(100+h)`, `waterShare = h/(100+h)`;
      water price = cheapest `|water`-suffixed key in the book, else `0`;
      return `null` when `flourName` is null or its flour has no price row.
- [x] **Step 3:** Write `costScaledRecipe(scaled, book): LoafCost`. Every
      ingredient gets `pricePerKg` (derived for `kind === 'starter'`),
      `cost = grams/1000 × pricePerKg`, or `null`. Accumulate `unpriced`.
      `perKg = total / (finishedGrams/1000)`, guarded against a zero weight.
- [x] **Step 4:** Verify with a scratch `tsx` script against the real `כפרי`
      percentages (27.7778 / 27.7778 / 37.2222 / 1.2222 / 11.1111) at ₪5/₪6/₪0/₪2,
      starter flour `קמח לבן`, hydration 100, waste 1.5.
      Expected: starter ₪3.75/kg, total ₪3.15, perKg ₪3.50.
- [x] **Step 5:** Verify the unpriced path: drop `קמח מלא`'s price →
      `complete === false`, `unpriced` contains `קמח מלא`, total excludes it,
      and starter still prices (its flour is `קמח לבן`).
- [x] **Step 6:** Commit `feat(cost): pure cost engine`.

---

### Task 3: DB wrapper + API route

> Changed during implementation: `loadLoafCosts` was replaced by
> `loadBreadsForCosting`. The screen recomputes costs as the owner types, so the
> math runs on the client off the same pure `cost.ts`; a server copy would have
> been a second implementation of the same arithmetic.

**Files:**
- Create: `src/lib/ingredient-costs.ts`
- Create: `src/app/api/ingredient-prices/route.ts`

**Interfaces:**
- Produces: `loadPriceBook(groupId)`, `loadIngredientsInUse(groupId)`,
  `loadLoafCosts(groupId, book)`.

- [x] **Step 1:** `loadPriceBook(groupId)` — select `ingredient_prices` for the
      group plus the three `groups` starter columns; return a `PriceBook`.
- [x] **Step 2:** `loadIngredientsInUse(groupId)` — join
      `bread_recipe_ingredients → bread_types` on `groupId`, **no `isActive`
      filter**, returning distinct `(name, kind)` with the bread names using each.
- [x] **Step 3:** `loadLoafCosts(groupId, book)` — for every bread type with a
      recipe, for every enabled size with a `weightGrams`, `scaleRecipe` then
      `costScaledRecipe`. Report `noRecipe` and `sizesMissingWeight` the way
      `order-recipe.ts:39-51` reports `unconfigured`.
- [x] **Step 4:** GET handler: `withGroup`, 403 for `baker`/`driver`, returns
      `{prices, inUse, starter, loaves}`.
- [x] **Step 5:** PUT handler: zod schema per spec §1.6; reject duplicate
      `(name, kind)`; write group settings + the whole price list in **one**
      `db.execute(sql\`WITH g AS (UPDATE …), cleared AS (DELETE …) INSERT …\`)`,
      with a separate branch for an empty list.
- [x] **Step 6:** `npx tsc --noEmit`.
- [x] **Step 7:** Probe live with forged init-data on a dev server: GET 200 with
      the five real ingredients in `inUse`; PUT the five prices; GET again and
      confirm `loaves` shows `כפרי` at the expected numbers; PUT a duplicate pair
      → 400; PUT as a baker → 403. Restore the DB to its prior state after.
- [x] **Step 8:** Commit `feat(cost): GET/PUT /api/ingredient-prices`.

---

### Task 4: The costs screen

**Files:**
- Create: `src/app/miniapp/settings/costs/page.tsx`
- Create: `src/components/catalog/IngredientPriceRow.tsx`
- Modify: `src/lib/i18n.ts` (a `costs.*` block)

- [x] **Step 1:** Add the Hebrew keys: title, the three block headings, field
      labels, `מחושב`, `לא בשימוש`, `אין מתכון`, `חסר משקל`, `חסר מחיר`,
      `לא כולל תוספות`, empty state, save/saved/failed.
- [x] **Step 2:** Build the page: fetch once, three blocks per spec §1.7, one
      `שמור`. Starter rows read-only showing the derived ₪/kg.
- [x] **Step 3:** Starter block: flour `<select>` over flour names in use,
      hydration and waste inputs, live derived ₪/kg beneath.
- [x] **Step 4:** Cost table: bread × size, `tabular-nums`, LTR-isolated numbers,
      the three "can't compute" states, footer `לא כולל תוספות`.
- [x] **Step 5:** Empty state when no bread type has a recipe, linking to `קטלוג`.
- [x] **Step 6:** `npx tsc --noEmit && npx next build`.
- [x] **Step 7:** Drive it headlessly, screenshot, check RTL and number direction.
- [x] **Step 8:** Commit `feat(cost): מחירי חומרי גלם screen`.

---

### Task 5: Entry point + cost line in the bread sheet

**Files:**
- Modify: `src/app/miniapp/settings/catalog/page.tsx`
- Modify: `src/components/RecipeEditor.tsx`

- [x] **Step 1:** Add a link row at the top of `קטלוג` to `/miniapp/settings/costs`,
      rendered only for owner/manager.
- [x] **Step 2:** In `RecipeEditor`'s read view, fetch `/ingredient-prices` lazily
      (owner/manager only) and render one line: `עלות ₪X · ₪Y/ק״ג` at the
      reference weight, or the missing-price note.
- [x] **Step 3:** `npx tsc --noEmit && npx next build`.
- [x] **Step 4:** Commit `feat(cost): cost readout in the catalogue`.

---

### Task 6: `SectionCard` + `BreadSheet` shell

**Files:**
- Create: `src/components/catalog/SectionCard.tsx`
- Create: `src/components/catalog/BreadSheet.tsx`
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Produces: `SectionCard` props `{title, subtitle?, dirty, saving, onSave,
  open, onToggle, children}`; `BreadSheet` props `{typeId, onClose, onSaved}`.

- [x] **Step 1:** `SectionCard`: header row (title, subtitle, dirty dot, chevron),
      collapsible body, and a `שמור` rendered **only** when `dirty`.
- [x] **Step 2:** `BreadSheet`: the overlay shell, section open/closed state,
      a `dirty: Record<sectionKey, boolean>` map fed by `onDirtyChange`, and an
      exit guard naming the dirty sections.
- [x] **Step 3:** Add i18n keys for the guard and the dirty indicator.
- [x] **Step 4:** `npx tsc --noEmit`.
- [x] **Step 5:** Commit `refactor(catalog): SectionCard + BreadSheet shell`.

---

### Task 7: Move the sheet's blocks into sections

**Files:**
- Create: `src/components/catalog/sections/{Details,Recipe,Sizes,Additions,Branding}Section.tsx`
- Modify: `src/app/miniapp/settings/catalog/page.tsx` (delete the overlay)
- Modify: `src/components/catalog/TierOverrideEditor.tsx` (drop save-on-blur)

- [x] **Step 1:** `DetailsSection` — name; `PATCH /bread-types/{id}`.
- [x] **Step 2:** `RecipeSection` — wraps `RecipeEditor` and the cost line; the
      recipe keeps its own endpoint but its save moves into the `SectionCard`
      contract.
- [x] **Step 3:** `SizesSection` — size chips, per-size price, and the tier
      overrides, all one draft committed by one `שמור`. Delete
      `TierOverrideEditor`'s on-blur write; it reports dirty upward instead.
- [x] **Step 4:** `AdditionsSection` — `PUT …/additions`.
- [x] **Step 5:** `BrandingSection` — type badge, image, per-size badges,
      collapsed by default.
- [x] **Step 6:** Delete the old overlay (`page.tsx:1226-1478`) and `saveType`;
      the list page keeps only the list and the two global accordions.
- [x] **Step 7:** Introduce `effectivePrice()` in `src/lib/pricing.ts` and use it
      in every file this task opens.
- [x] **Step 8:** Fix the hardcoded Hebrew and the wrong error keys named in
      spec §2.4, in the code this task moves.
- [x] **Step 9:** Defer `RecipeEditor`'s unconditional `GET /recipes` to first need.
- [x] **Step 10:** `npx tsc --noEmit && npx next build`.
- [x] **Step 11:** Drive the whole sheet headlessly: open a bread, edit each
      section, confirm the `שמור` appears only in the edited section, confirm
      the exit guard fires, confirm each save persists.
- [x] **Step 12:** Commit `refactor(catalog): one save model per section`.

---

### Task 8: Verify and push

- [x] **Step 1:** `npx tsc --noEmit && npx next build` — clean.
- [x] **Step 2:** Confirm the production DB is in the state it started in, except
      for the intended `0025` schema addition.
- [x] **Step 3:** Adversarial review pass over the diff.
- [x] **Step 4:** Push and report.
