# Home-made ingredients: priced and counted in hydration

Status: approved 2026-11-18, built.

## Why

The bakery uses more than one thing it makes itself: regular starter (מחמצת), stiff starter (מחמצת קשה), and tangzhong (טנזונג, flour cooked in liquid). Each is a mix of one flour and one liquid at its own ratio, so each has its own cost per kg and puts its own flour and water into the dough.

Today the app has one starter setting for the whole bakery (`groups.starter_flour_name`, `starter_hydration_pct`, `starter_waste_factor`), applied to every starter-kind row. A stiff starter is therefore priced like a regular one. Tangzhong has no way to be priced from what it is made of. Hydration counts only plain water rows against plain flour rows, so the water and flour inside starter and tangzhong are invisible.

The owner wants correct money and correct hydration without making recipes harder for the baker. The owner sets these up; the family bot (MCP) can propose changes to them.

## Goals

1. Each home-made ingredient has its own settings: one flour, one liquid, hydration (liquid per 100 g flour) and a waste factor. Its price per kg is derived from them.
2. Hydration everywhere it is shown counts the flour and liquid inside home-made ingredients ("total hydration").
3. The owner (and managers) manage the settings on the raw-material prices screen (`/miniapp/settings/catalog/costs`). Bakers and drivers never see them; that screen and its API are already closed to them.
4. The bakery MCP shows each home-made ingredient with its derived price, and Claude can propose changing one; the owner approves on the card, like every other proposal.

## Non-goals

- Recipes are written exactly as today. A home-made ingredient is one row with one weight. No sub-recipes, no build or feeding schedule, no prep step on the kitchen sheet.
- Baker's % per ingredient stays relative to the plain flour rows, as today. Only the hydration figure counts the hidden flour and liquid.
- One flour and one liquid per home-made ingredient. No blends.
- A home-made ingredient cannot be made from another home-made ingredient.
- The kitchen screen, print sheet, morning message and baker page change nothing.

## How it works

### What counts as home-made

- Every starter-kind recipe row is home-made, as today (the owner never buys starter).
- An `other`-kind row (for example טנזונג) is home-made when the owner marks it so on the prices screen. Otherwise it keeps a typed ₪/kg like any other ingredient.
- Identity is `(name, kind)`, the same key as `ingredient_prices`. Tangzhong is entered in recipes as an `other` row, so the kitchen sheet never lists it under מחמצת.
- Several starters are ordinary: wheat, spelt and rye starters (מחמצת חיטה, מחמצת כוסמין, מחמצת שיפון), and a stiff one, are separate starter-kind names in recipes, each with its own entry, flour, hydration and waste, so each has its own price and its own split in hydration. Recipes can already hold more than one starter row; the recipe save only refuses a repeated name.

### Settings and price

Each home-made ingredient stores:
- `flourName`: one flour-kind ingredient name, or null = not set up yet. Not limited to flours that appear as plain recipe rows: a rye starter is fed rye flour even when no bread lists rye flour on its own. The picker offers the flours in recipes and accepts a new flour name; when the chosen flour has no price row, the card shows a price field for it, saved as an ordinary `ingredient_prices` row (flour kind). Today's "starter flour no longer in any recipe" warning goes, since a feeding-only flour is normal.
- `liquid`: one ingredient by `(name, kind)`, either water-kind or an `other` ingredient with a typed price (for example milk). Not another home-made ingredient. A liquid used in no recipe (milk only inside tangzhong) still needs a price: when the chosen liquid has no price row, the card shows a price field for it, saved as an ordinary `ingredient_prices` row. A priced ingredient used as a home-made flour or liquid is not an orphan. If the liquid is later renamed, removed or made home-made itself, nothing is refused: the home-made ingredient reads as unpriced and names what is missing.
- `hydrationPct`: liquid per 100 g flour, integer 1–1000. Regular starter 100, stiff 50–60, tangzhong 1:5 = 500.
- `wasteFactor`: 1–10, as today (starter discard; for tangzhong, evaporation if the owner wants it).

Price per kg = `(100/(100+h) × flourPrice + h/(100+h) × liquidPrice) × waste`.
- Water-kind liquid keeps today's rule: its price if typed, else the cheapest typed water, else 0 (tap water is free).
- Missing flour or flour price, or an `other` liquid with no price, makes the ingredient unpriced (shown as missing, never ₪0), same as today's starter.

### Total hydration

One pure function, used by every surface (client and server):

```
flour  = Σ flour rows   + Σ home-made rows × 100/(100+h)
liquid = Σ water rows   + Σ home-made rows × h/(100+h)
total hydration = liquid / flour × 100
```

- Rows are the recipe's `pct_of_finished`, so the result does not depend on loaf size.
- The home-made liquid counts as liquid even when it is milk.
- A starter row whose settings are not set up (no flour chosen) cannot be split. It is left out, and the surface says which names were left out (for example "לא כולל: מחמצת קשה"). An `other` row that is not home-made (olives, seeds) is simply not counted, as today.
- The split needs only the hydration, not the flour or prices, so hydration works for a baker who cannot see prices.

Surfaces that show hydration, all switched to total hydration:
- The recipe view in the bread sheet (`RecipeEditor`, view mode): a new line "הידרציה כוללת N%" under the ingredient percentages, visible to bakers too. The edit-mode preview shows it live as rows change.
- The copy-recipe source list (`GET /api/recipes`, `CopyRecipeFlow`).
- MCP `get_recipes` (`hydrationPct`, plus the names left out).
- The recipe proposal card line `proposal.recipe_hydration`.

For bakers, `GET /api/bread-types/[id]/recipe` (and `GET /api/recipes`) return each home-made row's hydration (`h` only, no money), so the editor can compute live without the owner-only price book.

### The prices screen

- The "תמחור מחמצת" card becomes "מכינים בעצמנו". It lists every home-made ingredient in use: every starter-kind name in any recipe, plus every `other` row marked home-made. Each item shows its fields (flour picker, liquid picker, hydration, waste) and its derived ₪/kg, or what is missing.
- A short hint under the card gives the usual values: regular starter 100, stiff starter 50–60, tangzhong 1:5 = 500.
- A starter-kind name in a recipe with no saved settings (a new "מחמצת קשה" a baker just added) is listed with defaults (no flour, water, hydration 100, waste 1.5) and reads as not set up until the owner picks a flour and saves; the row is created on save.
- `other` rows in the typed-price list get a way to mark them "מכינים בעצמנו", which moves them to that card. A way back returns them to a typed price. Marking one home-made drops its typed price in the same save (the save sends the whole book, so the prune removes it).
- A home-made entry whose name no longer appears in any recipe is listed with the existing orphans ("מחירים ללא רכיב תואם") so a rename is visible, and can be removed there.
- The per-loaf cost table and the cost line in the recipe sheet use the new price book unchanged in shape for them: `costScaledRecipe` looks each home-made row up by `(name, kind)`.
- Save stays one statement (neon-http has no transactions), upsert-then-prune, as the price book already does.

### Data

- New table `home_made_ingredients`: `id`, `group_id` (FK groups), `name` varchar(100), `kind` ingredient_kind (only `starter` or `other`, enforced by a check), `flour_name` varchar(100) null, `liquid_name` varchar(100) not null, `liquid_kind` ingredient_kind not null (`water` or `other`), `hydration_pct` integer not null, `waste_factor` numeric(4,2) not null, timestamps. Unique `(group_id, name, kind)`.
- An `other` ingredient is either typed-price or home-made, never both. The two tables cannot enforce this together, so code does, in every write: the prices PUT refuses a body with both for one key; the home-made write (screen or proposal) deletes that key's typed price in the same statement; `upsertIngredientPrice` (the price proposal) refuses a key that is home-made.
- Migration: for each group, one row per distinct starter-kind name in its recipes, copying the group's current flour, hydration and waste, with liquid = the water rule (`liquid_name` "מים", kind water). Nothing priced today becomes unpriced.
- Code stops reading `groups.starter_*`. The columns are dropped in a later migration, not this one, so the deployment still serving during the build's migration keeps working. A starter edit saved in the minutes between the migration and the new deployment going live is lost; accepted.
- Existing hydration numbers change once (a recipe with starter shows a higher figure). That is the point; the old figure is not kept anywhere.

### MCP

- `get_ingredient_prices`: `starter` is replaced by `homeMade: [{ name, kind, setUp, flourName, liquidName, liquidKind, hydrationPct, wasteFactor, derivedPricePerKg | null }]`, listing saved rows and in-use starter names without one (`setUp: false`). `unpricedInUse` follows the new rule.
- `get_recipes`: `hydrationPct` becomes total hydration; add `hydrationLeavesOut: string[]`. The tool description says hydration counts the flour and liquid inside home-made ingredients.
- New tool `propose_home_made_ingredient` (proposal kind `home_made`, a new `change_proposal_kind` enum value): sets the full settings of one home-made ingredient by `(name, kind)`. For an `other` ingredient this also marks it home-made and drops its typed price. The name need not be in a recipe yet (Claude may propose a tangzhong recipe and its settings together); until a recipe uses it, the screen lists it with the orphans. A row that does not exist yet reads as `before: null`, like a new ingredient price. Stale check, expiry, owner-only approval and the single apply path (`src/lib/catalog-writes.ts`) work like every other kind. The card text lists what changes, in Hebrew, for example "מחמצת קשה: הידרציה 100% ← 50%".
- `propose_ingredient_price` keeps refusing starter, and now also refuses an `other` ingredient that is home-made, pointing to the new tool.

## Constraints

- All strings through `src/lib/i18n.ts`, native Hebrew, RTL. Digits in `dir="ltr"` spans only.
- Prices and hydration math in one pure module shared by client and server (`src/lib/cost.ts` or a sibling); no second copy.
- Owner/manager-only for settings and prices, enforced in the API (as `denyBakers` today). Hydration splits (no money) may reach bakers.
- No prod data used for testing; offline PGlite, typecheck, lint and build as the gate.

## Left to the builder

- Exact layout of the "מכינים בעצמנו" card and how an `other` row is marked home-made, following the screen's existing patterns.
- Default waste factor for a newly listed home-made ingredient (today's default is 1.5 for starter; 1 is sensible for `other`).
- Exact Hebrew copy beyond the names given here.

## Addendum 2026-11-18: home-made entries live in the catalogue

The owner asked to define home-made ingredients before any recipe uses them, with quick-fill values, in the catalogue screen next to sizes and additions, outside the prices screen.

- **Catalogue section "מכינים בעצמנו"** (`/miniapp/settings/catalog`, between additions and bread types, owner/manager only like sizes and additions). It lists every saved entry plus every starter name in a recipe that has no settings yet ("לא הוגדר"). Each row shows name, kind (מחמצת / אחר), flour, hydration and the derived ₪/kg or what is missing. A row expands to edit flour, liquid, hydration and waste, with save, cancel and delete, like an addition.
- **Add**: name, kind (מחמצת or אחר), then the same fields. Quick-fill buttons set hydration and waste (and kind when adding): מחמצת רגילה 100 / 1.5, מחמצת קשה 50 / 1.5, טנזונג 500 / 1 (kind אחר). The names are always the owner's own; nothing is pre-created.
- **The name is fixed once created.** It is the link to recipe rows (same name and kind), so renaming means deleting and adding again, and renaming the recipe row.
- **Delete**: removes the settings. A starter still in a recipe shows again as "לא הוגדר"; an `other` row in a recipe goes back to needing a typed price.
- **Recipe name suggestions** include saved entries by kind, so the baker picks "מחמצת שיפון" from the list.
- **Prices screen**: the home-made card and the mark/unmark buttons go away; prices are still typed only there. Home-made rows show their derived price read-only, with a link to the catalogue. Flours and liquids that home-made entries use are listed for pricing even when no recipe lists them, with "בשימוש ב־" naming the entries. Its save sends prices only and never touches home-made settings; a typed price for a home-made key is refused.
- **One write path**: the catalogue section saves through `upsertHomeMade`, deletes through `deleteHomeMade`, and both it and the MCP proposal check settings with one shared `checkHomeMade` (`src/lib/catalog-writes.ts`).

## Addendum 2026-11-18 (2): tangzhong is its own kind

Tangzhong was filed under `other`, which made "home-made" mean two things for one kind. It is now its own ingredient kind, and home-made means exactly `starter` or `tangzhong`.

- **Kind**: `ingredient_kind` gains `tangzhong` (shown טנזונג, listed after the starter in a recipe). Migration 0037 moves a bakery's existing home-made `other` entries, and the recipe rows with the same name in that bakery, to `tangzhong`; an unrelated `other` row stays. The home-made check becomes `kind IN ('starter','tangzhong')`.
- **No overlap any more**: a home-made kind never takes a typed price (the prices PUT, `upsertIngredientPrice` and the MCP price proposal refuse it), so the old "delete the typed price on write" and "refuse a home-made key" rules are gone. An `other` ingredient is always a bought, typed-price one.
- **Catalogue section**: the add form's kind toggle is מחמצת / טנזונג (no more אחר). Quick-fill: regular and stiff set kind starter; טנזונג sets kind tangzhong; when editing, only the chips that fit the entry's kind show. Switching kind while hydration and waste still equal the old kind's defaults resets them to the new kind's defaults (100 / 1.5 starter, 500 / 1 tangzhong); a value the owner changed is kept. A new entry's liquid is the bakery's own first water name.
- **Add-form checks**: a blank name, a name with line breaks or control characters, and a duplicate name and kind are each refused with a Hebrew message before sending (`homeMadeConflict`, shared with the server). The add sends `create: true`; the server answers 409 for a duplicate (for example one added from another device meanwhile), shown as the same "already exists" text.
- **Section loading**: it loads on mount so the header count shows while closed, and re-reads every time it is opened.
- **Prices screen**: a tangzhong row shows its derived price read-only, like a starter row, with the link to the catalogue.
- **Recipe editor and every surface** that groups ingredients (editor, baker page, kitchen and print sheet, morning message) offer and group טנזונג under its own heading through `groupByKind` / `kindLabel`.
