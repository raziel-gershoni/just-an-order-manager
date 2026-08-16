# Recipe duplication — design

**Status:** approved 2026-08-16
**Goal:** let a baker build a bread's recipe by copying an existing one, and fix
the defects in the recipe editor found while designing it.

## Background: how recipes are stored, and why

`bread_recipes` (PK `bread_type_id`) + `bread_recipe_ingredients`
(`name`, `kind`, `pct_of_finished numeric(7,4)`, `sort_order`).

`pct_of_finished` is grams of the ingredient per 100g of **finished, baked**
loaf. The original commit (`7096f9a`) states the intent: *"stored as % of
finished loaf weight (no absolute anchors), displayed in traditional baker's %
(flour=100)"*. Orders are placed in finished loaf sizes, so a per-finished-gram
recipe scales to any size by one multiplication, exactly.

Everything else is derived on read (`src/lib/recipe.ts`):

| derived | how | כפרי example |
|---|---|---|
| grams at weight W | `pct × W / 100` | `27.7778 × 900/100 = 250g` |
| baker's % | `pct ÷ Σ(flour pct) × 100` | `37.2222 ÷ 55.5556 = 67%` |
| bake loss | `Σ pct` | `105.1111` → 946g dough per 900g loaf |

**This model is kept unchanged.** It was investigated during design and is
sound. Two ideas were considered and rejected:

- *Store baker's % + a yield factor instead.* Rejected: `pct_of_finished` is
  already weight-independent, so duplication needs no schema change. The
  migration would touch five reading surfaces to improve a number no user sees.
- *Store the authoring reference weight.* Rejected: it never enters a
  calculation, so it cannot improve precision. Copying 900g → 700g → 1500g is
  pure multiplication and carries no weight with it.

## The one real precision defect

Storage is fractional and display is integral — the correct split. The leak is
that **the save path reads the display back**: `save()` sends `grams` for every
row and the API recomputes every percentage from those rounded integers. A
number that existed only to be looked at becomes the stored truth.

Measured, copying כפרי via a 700g bread and then to 1500g:

```
today   קמח לבן 416ג · מים 559ג · מלח 19ג · מחמצת 167ג
fixed   קמח לבן 417ג · מים 558ג · מלח 18ג · מחמצת 167ג
```

5.5% off on the salt, on a recipe nobody edited. The error is bounded per hop
(it re-derives rather than accumulates) but every hop can move a small
ingredient by a whole gram.

**Fix:** rows the baker did not touch send their exact stored `pct_of_finished`;
only rows typed into are derived from grams. `EditorRow` already carries
`originalPctOfFinished` and `dirty`, and `changeRefWeight` already honours them
— only `save()` ignores both.

Consequences: decimal gram entry is unnecessary (bakers type whole grams, which
is what happens at a scale), and the `startEdit` weight leak below drops from a
correctness bug to a cosmetic one.

## Scope

1. Copy flow — source picker → flour step (with merge) → pre-filled editor
2. Lossless save — untouched rows keep their exact percentages
3. Ingredient name picker — names drawn from every recipe in the group
4. Atomic save
5. Row-key fix — deleting a row corrupts the inputs below it
6. `startEdit` stops inheriting the calculator's weight

Explicitly out of scope: storage-model migration, reference-weight column,
decimal grams, process notes, recipes as first-class named entities, changing
the from-scratch template's numbers.

## 1. Copy flow

Entry point: the empty state of `RecipeEditor`, inside the bread detail panel in
settings → catalog. Today that state offers only `+ מתכון חדש`; it gains
`⧉ העתק מ־`. A bread that already has a recipe does **not** offer copy — replacing
an existing recipe is what edit and delete are for, and a destructive overwrite
behind a copy button is a trap.

Three steps, all inside the existing panel (no new route):

**Step 1 — source picker.** Every active bread type in the group with a recipe,
showing name, ingredient count and hydration. Breads without a recipe are listed
greyed and unselectable, so the list doubles as an at-a-glance map of what is
still unconfigured. The current bread is excluded.

**Step 2 — flour step.** The source's flour rows, each with its baker's % fixed
and its name editable via the ingredient name picker (§3). Non-flour rows are
shown as a read-only summary line — they cross over untouched.

A **`מזג קמחים`** button appears only when the source has two or more flours. It
collapses them into a single row whose percentage is their sum, for the common
case of a variation that swaps a blend for one flour. It is reversible within
the step (`בטל מיזוג`) until the baker continues.

**Step 3 — editor.** The normal editor opens pre-filled, at **the target
bread's** own default reference weight, never the source's. Nothing is written
until the baker saves, so backing out at any point leaves no recipe behind.

Copied rows arrive with `dirty: false` and their exact `originalPctOfFinished`,
so an unedited copy stores the source's percentages bit-for-bit (§2). A flour
row that was renamed is still `dirty: false` — renaming does not change the
quantity, and its percentage must survive the copy intact. A **merged** flour row
carries the summed percentage as its `originalPctOfFinished`, also `dirty: false`.

## 2. Lossless save

`PUT /api/bread-types/[id]/recipe` accepts, per ingredient, exactly one of:

- `grams: number` — derived against `referenceFinishedGrams`, as today
- `pctOfFinished: number` — stored verbatim

`referenceFinishedGrams` stays required; it is meaningless for pct rows but the
payload may mix both kinds. The dough-total sanity check (`Σ grams ≥
referenceFinishedGrams`) resolves pct rows to grams first so it keeps working on
mixed payloads.

`save()` sends `pctOfFinished` for any row where `!dirty && originalPctOfFinished
!= null`, and `grams` otherwise.

## 3. Ingredient name picker

New `GET /api/recipes` (group-scoped, same auth as the recipe routes — bakers
included) returns every recipe in the group with its ingredients, plus the
distinct ingredient names in use, bucketed by kind:

```jsonc
{
  "recipes": [{ "breadTypeId": 9, "breadTypeName": "כפרי",
                "hydrationPct": 67, "ingredients": [ /* name, kind, pctOfFinished, pctOfFlour, sortOrder */ ] }],
  "namesByKind": { "flour": ["קמח לבן", "קמח מלא"], "water": ["מים"],
                   "starter": ["מחמצת"], "salt": ["מלח"], "other": [] }
}
```

One call serves all three needs: the source picker's list, the flour step's rows,
and the name picker's suggestions. At this scale (tens of rows) a single query
pair is cheaper than paging.

The picker is a `<datalist>`-backed text input — it suggests without
constraining, so a new ingredient is always typeable. Suggestions are filtered to
the row's own kind, since a flour row wants flours.

A row whose name duplicates another row **in the same recipe** is flagged inline
(`שם חוזר`) and blocks save. Two rows called מים are always a mistake, and
`sumScaledByType` keys on `name|kind`, so duplicates would silently merge on the
daily aggregate.

## 4. Atomic save

Today `PUT` deletes all ingredient rows, then upserts the recipe row, then
inserts — three statements. A failure between them leaves a bread that looks
configured with zero ingredients, which reads downstream as "no recipe" on the
baker screen and prints nothing on the packing sheet.

neon-http has no interactive transactions, so the fix is to make the write one
statement. Delete-then-insert becomes a single `WITH` CTE:

```sql
WITH del AS (DELETE FROM bread_recipe_ingredients WHERE bread_type_id = $1)
INSERT INTO bread_recipe_ingredients (bread_type_id, name, kind, pct_of_finished, sort_order)
VALUES …
```

executed via `db.execute(sql`…`)`. The parent `bread_recipes` upsert stays a
separate statement but is idempotent and carries no ingredient data, so it is
safe to run first: a recipe row with no ingredients is the state we already
tolerate before the first save.

## 5. Row-key fix

`RecipeEditor` renders rows with `key={idx}`. Deleting the third of five rows
makes React reuse DOM nodes by position, so the inputs below show the previous
row's values. `EditorRow` gains a stable `id` (a monotonic counter, not
`crypto.randomUUID()` — these never leave the client and a counter is
deterministic), used as the key. `removeRow`/`addRow` keep reassigning
`sortOrder` by position as they do now.

## 6. `startEdit` weight

```ts
const weight = Number(displayWeight) || defaultReferenceWeight || 1000;
```

`displayWeight` belongs to the read-only "הצג בגרמים" calculator. Typing 700
there to see what a smaller loaf needs, then hitting the pencil, silently makes
700 the editor's basis. Reversed to prefer `defaultReferenceWeight` — the bread's
own enabled size — falling back to `displayWeight` only when the bread has no
sized variant, then 1000.

## Files

| file | change |
|---|---|
| `src/app/api/recipes/route.ts` | new — group recipes + names by kind |
| `src/app/api/bread-types/[id]/recipe/route.ts` | PUT accepts `pctOfFinished`; atomic CTE write |
| `src/lib/recipe.ts` | `recipeFromEntries` accepting mixed grams/pct rows |
| `src/components/RecipeEditor.tsx` | lossless save, stable keys, name picker, `startEdit` weight, copy entry point |
| `src/components/recipe/CopyRecipeFlow.tsx` | new — source picker + flour step |
| `src/components/recipe/IngredientNameInput.tsx` | new — datalist-backed input |
| `src/lib/i18n.ts` | Hebrew strings |

`RecipeEditor.tsx` is 456 lines and gains behaviour; the copy flow and the name
input are extracted as siblings under `src/components/recipe/` rather than grown
inside it.

## Verification

No test runner in this repo. The gate is `npx tsc --noEmit` + `npx next build`,
plus:

- A node simulation of the copy chain 900 → 700 → 1500 → 900 asserting the
  percentages are bit-identical at every hop (the numbers in this spec).
- Headless-Chrome render of the packing sheet after a copy, confirming the
  weigh-out block reflects the new recipe.
- Manual: copy כפרי onto a bread with no recipe, merge its two flours, save,
  confirm the baker screen and the לישה block agree.
