# Recipe Duplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a baker build a bread's recipe by copying an existing one, and fix the five defects found in the recipe editor while designing it.

**Architecture:** The storage model (`pct_of_finished`) is unchanged — it is already weight-independent, so copying is just carrying the percentage rows across. The work is a new read endpoint that serves the source picker and the name suggestions, a widened PUT that accepts percentages for untouched rows, and two new client components beside the existing `RecipeEditor`.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript, Drizzle ORM on Neon Postgres (neon-http — **no interactive transactions**), zod/v4, Tailwind, Hebrew/RTL only.

**Spec:** `docs/superpowers/specs/2026-08-16-recipe-duplication-design.md`

## Global Constraints

- Hebrew/RTL only. No i18n switching — every user-facing string goes through `src/lib/i18n.ts`, whose `t(key, lang?)` ignores `lang`.
- No test runner exists. The verification gate for every task is `npx tsc --noEmit` then `npx next build`. **Never run `npm run build`** — it runs migrations against the production database.
- neon-http has no interactive transactions. Multi-row atomicity must be expressed as a single SQL statement via `db.execute(sql\`…\`)`.
- No schema migration in this plan. `bread_recipes` and `bread_recipe_ingredients` are untouched.
- `pct_of_finished` is `numeric(7,4)`; write it with `.toFixed(4)` as the existing code does.
- Commit trailers, verbatim, on every commit:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CQkBxFKHQNxmwV3fjqC8tX
  ```
- Ingredient kinds are exactly `'flour' | 'water' | 'salt' | 'starter' | 'other'`.
- Scratch/simulation scripts live in the scratchpad dir, never in the repo.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/recipe.ts` (modify) | Add `recipeFromEntries` — builds a `Recipe` from rows that carry *either* grams or an exact percentage. Existing `recipeFromGrams` becomes a thin wrapper so its callers are untouched. |
| `src/app/api/recipes/route.ts` (create) | One group-scoped GET serving all three client needs: which breads have recipes, their ingredients, and the distinct ingredient names by kind. |
| `src/app/api/bread-types/[id]/recipe/route.ts` (modify) | PUT accepts mixed grams/pct rows; the ingredient write becomes one atomic CTE statement. |
| `src/components/recipe/IngredientNameInput.tsx` (create) | Datalist-backed text input. Suggests, never constrains. |
| `src/components/recipe/CopyRecipeFlow.tsx` (create) | The two pre-editor steps: source picker, then flour step with merge. Owns no persistence — hands rows back to `RecipeEditor`. |
| `src/components/RecipeEditor.tsx` (modify) | Lossless save, stable row keys, name picker in rows, `startEdit` weight, and the copy entry point. |
| `src/lib/i18n.ts` (modify) | Hebrew strings for everything above. |

`RecipeEditor.tsx` is 456 lines and gains behaviour, so the flow and the input are siblings under `src/components/recipe/` rather than growth inside it.

---

### Task 1: `recipeFromEntries` — accept grams or exact percentages

**Files:**
- Modify: `src/lib/recipe.ts:142-157` (`recipeFromGrams`)
- Verify: scratchpad simulation script (no repo test file — no test runner)

**Interfaces:**
- Produces:
  ```ts
  export type RecipeEntry = {
    name: string;
    kind: IngredientKind;
    sortOrder: number;
  } & ({ grams: number; pctOfFinished?: undefined }
     | { pctOfFinished: number; grams?: undefined });

  export function recipeFromEntries(
    referenceFinishedGrams: number,
    rows: RecipeEntry[]
  ): Recipe;

  export function entryGrams(
    referenceFinishedGrams: number,
    row: RecipeEntry
  ): number;
  ```
- Consumes: existing `Recipe`, `IngredientKind` from the same file.

- [ ] **Step 1: Write `recipeFromEntries` and `entryGrams`**

In `src/lib/recipe.ts`, replace the existing `recipeFromGrams` block with:

```ts
/**
 * A row on its way into storage. It carries EITHER the grams a baker typed —
 * which must be divided by the loaf weight they typed them against — OR an
 * exact percentage that is already storage-shaped and must not be re-derived.
 *
 * The second case is what keeps a copied recipe lossless: a row nobody touched
 * still round-trips through a display that rounds to whole grams, and rounding
 * a number for the eye must never become the number of record.
 */
export type RecipeEntry = {
  name: string;
  kind: IngredientKind;
  sortOrder: number;
} & (
  | { grams: number; pctOfFinished?: undefined }
  | { pctOfFinished: number; grams?: undefined }
);

/** What this row weighs on a loaf of `referenceFinishedGrams`. */
export function entryGrams(referenceFinishedGrams: number, row: RecipeEntry): number {
  return row.grams !== undefined
    ? row.grams
    : (row.pctOfFinished * referenceFinishedGrams) / 100;
}

export function recipeFromEntries(
  referenceFinishedGrams: number,
  rows: RecipeEntry[]
): Recipe {
  if (referenceFinishedGrams <= 0) {
    throw new Error('referenceFinishedGrams must be > 0');
  }
  return {
    ingredients: rows.map((r) => ({
      name: r.name,
      kind: r.kind,
      pctOfFinished:
        r.pctOfFinished !== undefined
          ? r.pctOfFinished
          : (r.grams / referenceFinishedGrams) * 100,
      sortOrder: r.sortOrder,
    })),
  };
}

/**
 * Build a Recipe from baker's gram entry — the all-grams case, kept for callers
 * that have no percentages to preserve.
 */
export function recipeFromGrams(
  referenceFinishedGrams: number,
  rows: { name: string; kind: IngredientKind; grams: number; sortOrder: number }[]
): Recipe {
  return recipeFromEntries(referenceFinishedGrams, rows);
}
```

- [ ] **Step 2: Verify the precision claim with a simulation**

Write to the scratchpad (NOT the repo) `losslessness.mjs`, which reproduces the spec's table by simulating a copy chain both ways:

```js
const orig = [['קמח לבן',27.7778],['מים',37.2222],['מלח',1.2222],['מחמצת',11.1111],['קמח מלא',27.7778]];
// today: every row re-derived from its rounded display
const saveToday = (p,W)=>p.map(([n,v])=>[n,Number(((Math.round(v*W/100))/W*100).toFixed(4))]);
// fixed: untouched rows pass their exact pct through
const saveFixed = (p)=>p;
const show=(p,W)=>p.map(([n,v])=>`${n} ${Math.round(v*W/100)}ג`).join(' · ');
for (const [label,save] of [['TODAY',saveToday],['FIXED',saveFixed]]) {
  let cur = orig;
  for (const W of [700,1500]) cur = save(cur,W);
  console.log(label, show(cur,1500));
}
```

Run: `node losslessness.mjs`
Expected output — the two lines must differ, and FIXED must show 18ג of salt:
```
TODAY קמח לבן 416ג · מים 559ג · מלח 19ג · מחמצת 167ג · קמח מלא 416ג
FIXED קמח לבן 417ג · מים 558ג · מלח 18ג · מחמצת 167ג · קמח מלא 417ג
```
If FIXED does not show `מלח 18ג`, the premise of Task 3 is wrong — stop and re-check before continuing.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output. `recipeFromGrams`'s two existing callers (`api/bread-types/[id]/recipe/route.ts:113`, and nothing else) still compile because the wrapper's signature is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/lib/recipe.ts
git commit -m "feat(recipe): recipeFromEntries accepts exact percentages

A row the baker never touched should keep the percentage already in
storage rather than be re-derived from a display that rounds to whole
grams. recipeFromGrams stays as the all-grams wrapper."
```

---

### Task 2: `GET /api/recipes` — every recipe in the group, and the names in use

**Files:**
- Create: `src/app/api/recipes/route.ts`
- Read for pattern: `src/app/api/baker/route.ts` (uses `withGroup`), `src/lib/order-recipe.ts:104-120` (recipe row loading)

**Interfaces:**
- Consumes: `withGroup`, `jsonResponse` from `@/lib/api-utils`; `withBakersPercents`, `KIND_DISPLAY_ORDER`, `type IngredientKind` from `@/lib/recipe`.
- Produces the response consumed by Tasks 4 and 5:
  ```ts
  {
    recipes: {
      breadTypeId: number;
      breadTypeName: string;
      hydrationPct: number | null;
      ingredients: {
        name: string; kind: IngredientKind;
        pctOfFinished: number; pctOfFlour: number; sortOrder: number;
      }[];
    }[];
    namesByKind: Record<IngredientKind, string[]>;
  }
  ```

- [ ] **Step 1: Write the route**

```ts
import { withGroup, jsonResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { breadTypes, breadRecipes, breadRecipeIngredients } from '@/db/schema';
import { eq, and, inArray, asc } from 'drizzle-orm';
import { withBakersPercents, KIND_DISPLAY_ORDER, type IngredientKind } from '@/lib/recipe';

/**
 * Every configured recipe in the group, plus the ingredient names already in
 * use. One call rather than three: the copy flow needs the source list AND the
 * chosen source's rows AND the name suggestions, and at this scale (tens of
 * rows) a second round trip costs more than the rows do.
 *
 * Bakers may read this — they own recipes here, same as the per-type GET.
 */
export const GET = withGroup(async (_request, _auth, groupId) => {
  const types = await db
    .select({ id: breadTypes.id, name: breadTypes.name, sortOrder: breadTypes.sortOrder })
    .from(breadTypes)
    .where(and(eq(breadTypes.groupId, groupId), eq(breadTypes.isActive, true)))
    .orderBy(asc(breadTypes.sortOrder));

  const typeIds = types.map((t) => t.id);
  const empty = { recipes: [], namesByKind: blankNames() };
  if (typeIds.length === 0) return jsonResponse(empty);

  const recipeRows = await db
    .select({ breadTypeId: breadRecipes.breadTypeId })
    .from(breadRecipes)
    .where(inArray(breadRecipes.breadTypeId, typeIds));
  if (recipeRows.length === 0) return jsonResponse(empty);

  const configured = recipeRows.map((r) => r.breadTypeId);
  const ingredientRows = await db
    .select()
    .from(breadRecipeIngredients)
    .where(inArray(breadRecipeIngredients.breadTypeId, configured))
    .orderBy(asc(breadRecipeIngredients.sortOrder));

  const byType = new Map<number, typeof ingredientRows>();
  for (const row of ingredientRows) {
    const list = byType.get(row.breadTypeId) ?? [];
    list.push(row);
    byType.set(row.breadTypeId, list);
  }

  const namesByKind = blankNames();
  for (const row of ingredientRows) {
    if (!namesByKind[row.kind].includes(row.name)) namesByKind[row.kind].push(row.name);
  }
  for (const kind of KIND_DISPLAY_ORDER) {
    namesByKind[kind].sort((a, b) => a.localeCompare(b, 'he'));
  }

  const recipes = types
    .filter((t) => (byType.get(t.id)?.length ?? 0) > 0)
    .map((t) => {
      const rows = byType.get(t.id)!;
      const bakers = withBakersPercents({
        ingredients: rows.map((r) => ({
          name: r.name,
          kind: r.kind,
          pctOfFinished: Number(r.pctOfFinished),
          sortOrder: r.sortOrder,
        })),
      });
      const water = bakers.ingredients
        .filter((i) => i.kind === 'water')
        .reduce((sum, i) => sum + i.pctOfFlour, 0);
      return {
        breadTypeId: t.id,
        breadTypeName: t.name,
        // Hydration is the number a baker recognises a dough by; null when the
        // recipe carries no water at all (a dry mix), rather than a bare 0.
        hydrationPct: water > 0 ? Math.round(water) : null,
        ingredients: bakers.ingredients.map((i) => ({
          name: i.name,
          kind: i.kind,
          pctOfFinished: i.pctOfFinished,
          pctOfFlour: i.pctOfFlour,
          sortOrder: i.sortOrder,
        })),
      };
    });

  return jsonResponse({ recipes, namesByKind });
});

function blankNames(): Record<IngredientKind, string[]> {
  return { flour: [], water: [], salt: [], starter: [], other: [] };
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: tsc silent; the build's route table lists `ƒ /api/recipes`.

- [ ] **Step 3: Verify against live data**

Write to the scratchpad `checkrecipes.ts`, copy it to the repo root to run (module resolution needs the repo's node_modules), then delete it:

```ts
import { db } from './src/db';
import { breadRecipeIngredients } from './src/db/schema';
import { asc } from 'drizzle-orm';
async function main() {
  const rows = await db.select().from(breadRecipeIngredients).orderBy(asc(breadRecipeIngredients.sortOrder));
  console.log('ingredient rows:', rows.length);
  console.log('names:', [...new Set(rows.map(r => `${r.kind}:${r.name}`))].join(' · '));
}
main().then(() => process.exit(0));
```

Run: `DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config checkrecipes.ts`
Expected: 5 rows, names `flour:קמח לבן · water:מים · salt:מלח · starter:מחמצת · flour:קמח מלא`. This confirms `namesByKind` will have two flours to offer.
Then: `rm -f checkrecipes.ts`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/recipes/route.ts
git commit -m "feat(recipe): GET /api/recipes — group recipes + names in use

One call serves the copy flow's source list, the chosen source's rows,
and the name suggestions."
```

---

### Task 3: PUT accepts percentages, and writes atomically

**Files:**
- Modify: `src/app/api/bread-types/[id]/recipe/route.ts:71-146`

**Interfaces:**
- Consumes: `recipeFromEntries`, `entryGrams`, `type RecipeEntry` from Task 1.
- Produces the PUT contract Task 5 posts to: each ingredient carries exactly one of `grams` or `pctOfFinished`.

- [ ] **Step 1: Widen the zod schema**

Replace `putSchema` (line 73) with:

```ts
const putSchema = z.object({
  referenceFinishedGrams: z.number().int().positive(),
  ingredients: z
    .array(
      z
        .object({
          name: z.string().min(1).max(100),
          kind: ingredientKindSchema,
          sortOrder: z.number().int().nonnegative().default(0),
          grams: z.number().positive().optional(),
          pctOfFinished: z.number().positive().optional(),
        })
        // Exactly one: a row is either something the baker typed in grams, or a
        // percentage carried over untouched. Accepting both would leave the
        // server picking which one is the truth.
        .refine((r) => (r.grams === undefined) !== (r.pctOfFinished === undefined), {
          message: 'Each ingredient needs exactly one of grams or pctOfFinished',
        })
    )
    .min(1),
});
```

- [ ] **Step 2: Resolve pct rows before the sanity checks**

Replace the body of PUT from the `hasFlour` check (line 98) through the `recipeFromGrams` call (line 113) with:

```ts
  const { referenceFinishedGrams, ingredients } = parsed.data;
  const entries = ingredients as RecipeEntry[];

  const hasFlour = entries.some((i) => i.kind === 'flour');
  if (!hasFlour) {
    return errorResponse('Recipe must include at least one flour ingredient', 400);
  }

  // Two rows with the same name silently merge in sumScaledByType, which keys
  // on name|kind — so the daily aggregate would quietly under-report.
  const names = entries.map((i) => i.name.trim());
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) {
    return errorResponse(`Ingredient "${duplicate}" appears twice`, 400);
  }

  // Percentage rows have to be resolved to grams before this comparison, or a
  // mixed payload would compare a partial sum against the whole loaf.
  const totalGrams = entries.reduce((sum, i) => sum + entryGrams(referenceFinishedGrams, i), 0);
  if (totalGrams < referenceFinishedGrams) {
    return errorResponse(
      `Total ingredient weight (${Math.round(totalGrams)}g) is less than finished loaf weight (${referenceFinishedGrams}g) — bread can't bake heavier than its dough`,
      400
    );
  }

  const recipe = recipeFromEntries(referenceFinishedGrams, entries);
```

Update the import on line 6 to:
```ts
import { recipeFromEntries, entryGrams, withBakersPercents, type Recipe, type RecipeEntry } from '@/lib/recipe';
```

- [ ] **Step 3: Make the ingredient write one statement**

Replace the write block (lines 115-143, from `// Upsert: clear ingredients` through the closing brace of the `if (recipe.ingredients.length > 0)`) with:

```ts
  // The parent row first: it carries no ingredient data and is idempotent, and
  // "recipe row with no ingredients" is a state we already tolerate before the
  // first save.
  const [existing] = await db
    .select()
    .from(breadRecipes)
    .where(eq(breadRecipes.breadTypeId, breadTypeId))
    .limit(1);

  if (existing) {
    await db
      .update(breadRecipes)
      .set({ updatedAt: new Date() })
      .where(eq(breadRecipes.breadTypeId, breadTypeId));
  } else {
    await db.insert(breadRecipes).values({ breadTypeId });
  }

  // Delete + insert as ONE statement. neon-http has no interactive
  // transactions, so a two-statement swap can strand a bread that looks
  // configured with zero ingredients — which every read surface renders as
  // "no recipe", silently.
  const values = recipe.ingredients.map(
    (i) =>
      sql`(${breadTypeId}, ${i.name.trim()}, ${i.kind}::ingredient_kind, ${i.pctOfFinished.toFixed(4)}, ${i.sortOrder})`
  );
  await db.execute(sql`
    WITH cleared AS (
      DELETE FROM bread_recipe_ingredients WHERE bread_type_id = ${breadTypeId}
    )
    INSERT INTO bread_recipe_ingredients (bread_type_id, name, kind, pct_of_finished, sort_order)
    VALUES ${sql.join(values, sql`, `)}
  `);

  return jsonResponse({ ok: true });
```

Add `sql` to the drizzle import on line 4:
```ts
import { eq, asc, sql } from 'drizzle-orm';
```

- [ ] **Step 4: Confirm the enum cast name**

The `::ingredient_kind` cast must match the Postgres enum's actual name.

Run: `grep -n "ingredient_kind\|ingredientKindEnum" src/db/schema.ts drizzle/0007_recipes.sql`
Expected: the enum is created as `ingredient_kind`. If it differs, correct the cast to the real name before continuing.

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: both clean.

- [ ] **Step 6: Exercise the write against the live database**

Write `putcheck.ts` at the repo root, run, delete. It saves כפרי's own rows back as **percentages** and asserts nothing changed — the losslessness claim, end to end:

```ts
import { db } from './src/db';
import { breadRecipeIngredients } from './src/db/schema';
import { eq, asc } from 'drizzle-orm';
import { recipeFromEntries, type RecipeEntry } from './src/lib/recipe';

async function main() {
  const before = await db.select().from(breadRecipeIngredients)
    .where(eq(breadRecipeIngredients.breadTypeId, 9)).orderBy(asc(breadRecipeIngredients.sortOrder));
  const entries: RecipeEntry[] = before.map((r) => ({
    name: r.name, kind: r.kind, sortOrder: r.sortOrder, pctOfFinished: Number(r.pctOfFinished),
  }));
  const rebuilt = recipeFromEntries(900, entries);
  const same = rebuilt.ingredients.every((i, n) => i.pctOfFinished === Number(before[n].pctOfFinished));
  console.log('percentages preserved exactly:', same);
  console.log(rebuilt.ingredients.map((i) => `${i.name} ${i.pctOfFinished}`).join(' · '));
}
main().then(() => process.exit(0));
```

Run: `DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config putcheck.ts`
Expected: `percentages preserved exactly: true`, and the values `27.7778 / 37.2222 / 1.2222 / 11.1111 / 27.7778`.
Then: `rm -f putcheck.ts`

- [ ] **Step 7: Commit**

```bash
git add src/app/api/bread-types/\[id\]/recipe/route.ts
git commit -m "fix(recipe): lossless + atomic recipe writes

PUT now takes pctOfFinished for rows the baker never touched, so a
rounded display can no longer become the stored recipe. The ingredient
swap is one CTE — neon-http has no transactions, and the old
delete-then-insert could strand a bread with zero ingredients."
```

---

### Task 4: `IngredientNameInput` — suggest without constraining

**Files:**
- Create: `src/components/recipe/IngredientNameInput.tsx`
- Read for pattern: `src/components/ui/Input.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function IngredientNameInput(props: {
    value: string;
    onChange: (value: string) => void;
    kind: IngredientKind;
    namesByKind: Record<IngredientKind, string[]>;
    placeholder?: string;
    duplicate?: boolean;
    className?: string;
  }): JSX.Element;
  ```
- Consumed by Tasks 5 and 6.

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useId } from 'react';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import type { IngredientKind } from '@/lib/recipe';

/**
 * A name field that offers what the bakery already calls things. A datalist
 * rather than a select: across fifteen breads you retype קמח / מים / מלח /
 * מחמצת constantly, but a new ingredient must never be harder to enter than an
 * old one.
 *
 * Suggestions are filtered to the row's own kind — a flour row wants flours.
 */
export function IngredientNameInput({
  value,
  onChange,
  kind,
  namesByKind,
  placeholder,
  duplicate,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  kind: IngredientKind;
  namesByKind: Record<IngredientKind, string[]>;
  placeholder?: string;
  duplicate?: boolean;
  className?: string;
}) {
  const listId = useId();
  const suggestions = namesByKind[kind] ?? [];

  return (
    <div className={cn('min-w-0', className)}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={suggestions.length > 0 ? listId : undefined}
        aria-invalid={duplicate || undefined}
        className={cn('text-sm', duplicate && 'border-destructive')}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Confirm `Input` forwards unknown props**

`list` must reach the DOM `<input>`. Run:

`grep -n "props\|\.\.\.rest\|InputHTMLAttributes" src/components/ui/Input.tsx`

Expected: the component spreads its remaining props onto the `<input>`. If it does not, add `list?: string` to its props and forward it explicitly — a datalist that never binds silently degrades to a plain field.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/recipe/IngredientNameInput.tsx
git commit -m "feat(recipe): ingredient name input backed by names in use"
```

---

### Task 5: Editor — lossless save, stable keys, name picker, startEdit weight

**Files:**
- Modify: `src/components/RecipeEditor.tsx`
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Consumes: `IngredientNameInput` (Task 4), `GET /api/recipes` (Task 2), the widened PUT (Task 3).
- Produces, for Task 6:
  ```ts
  export interface SeedRow {
    name: string;
    kind: IngredientKind;
    pctOfFinished: number;   // exact, carried from the source
    sortOrder: number;
  }
  // RecipeEditor gains an internal seedFromCopy(rows: SeedRow[]) entry path.
  ```

- [ ] **Step 1: Add the Hebrew strings**

In `src/lib/i18n.ts`, beside the existing `settings.*` recipe keys:

```ts
  'settings.copy_recipe': 'העתק מ־',
  'settings.copy_pick_source': 'ממתכון של',
  'settings.copy_no_sources': 'אין עדיין מתכון להעתיק ממנו',
  'settings.copy_flours_title': 'הקמחים במתכון',
  'settings.copy_flours_hint': 'שאר הרכיבים עוברים כמו שהם',
  'settings.copy_merge_flours': 'מזג קמחים',
  'settings.copy_unmerge_flours': 'בטל מיזוג',
  'settings.copy_continue': 'המשך לעריכה',
  'settings.copy_back': 'חזרה',
  'settings.ingredient_duplicate': 'שם חוזר',
  'settings.hydration': 'הידרציה',
  'settings.ingredients_count': 'רכיבים',
```

- [ ] **Step 2: Give rows a stable id**

In `src/components/RecipeEditor.tsx`, add `id` to `EditorRow` (line 27) and a counter above the component:

```ts
interface EditorRow {
  /** Stable across reorder and delete. React keys by array index make the
   *  inputs below a deleted row show the previous row's values. */
  id: number;
  name: string;
  kind: IngredientKind;
  grams: string;
  sortOrder: number;
  originalPctOfFinished?: number;
  dirty: boolean;
}

// Client-only and never persisted, so a counter beats crypto.randomUUID(): it
// is deterministic and readable in React DevTools.
let nextRowId = 1;
const newRowId = () => nextRowId++;
```

Add `id: newRowId()` to every place an `EditorRow` is constructed: `defaultTemplate` (each of the four rows), `startEdit`'s `.map`, and `addRow`. Change the render key at line 267 from `key={idx}` to `key={r.id}`.

- [ ] **Step 3: Fix the `startEdit` weight**

At line 126, reverse the precedence:

```ts
  function startEdit() {
    if (!recipe) return;
    // The bread's own size, not the "הצג בגרמים" calculator's weight. That box
    // is for looking at a different loaf; letting it set the editor's basis
    // means a tool for reading quietly changes what gets written.
    const weight = defaultReferenceWeight || Number(displayWeight) || 1000;
```

- [ ] **Step 4: Make save lossless**

Replace the `ingredients` mapping inside `save()` (line 209) with:

```ts
        ingredients: validRows.map((r, i) => ({
          name: r.name.trim(),
          kind: r.kind,
          sortOrder: i,
          // Untouched rows keep the percentage already in storage. Deriving it
          // again from the grams on screen would bake this loaf's rounding
          // into the recipe — the whole reason a copy degrades today.
          ...(!r.dirty && r.originalPctOfFinished != null
            ? { pctOfFinished: r.originalPctOfFinished }
            : { grams: Number(r.grams) }),
        })),
```

- [ ] **Step 5: Block duplicate names in the editor**

Above the `save()` function add:

```ts
  /** Row indexes whose trimmed name collides with an earlier row's. */
  const duplicateRowIds = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes = new Set<number>();
    for (const r of rows) {
      const key = r.name.trim();
      if (!key) continue;
      if (seen.has(key)) dupes.add(r.id);
      else seen.set(key, r.id);
    }
    return dupes;
  }, [rows]);
```

and at the top of `save()`, after the existing flour check:

```ts
    if (duplicateRowIds.size > 0) {
      toast.error(t('settings.ingredient_duplicate'));
      return;
    }
```

- [ ] **Step 6: Load the group's names and swap in the picker**

Add state and a fetch beside the existing recipe fetch:

```ts
  const [namesByKind, setNamesByKind] = useState<Record<IngredientKind, string[]>>({
    flour: [], water: [], salt: [], starter: [], other: [],
  });
  const [sources, setSources] = useState<GroupRecipe[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ recipes: GroupRecipe[]; namesByKind: Record<IngredientKind, string[]> }>('/recipes')
      .then((res) => {
        if (cancelled) return;
        setNamesByKind(res.namesByKind);
        setSources(res.recipes.filter((r) => r.breadTypeId !== breadTypeId));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [breadTypeId]);
```

with the shared type declared at the top of the file:

```ts
export interface GroupRecipe {
  breadTypeId: number;
  breadTypeName: string;
  hydrationPct: number | null;
  ingredients: {
    name: string; kind: IngredientKind;
    pctOfFinished: number; pctOfFlour: number; sortOrder: number;
  }[];
}
```

Then replace the name `<Input>` in the row grid (lines 268-273) with:

```tsx
              <IngredientNameInput
                value={r.name}
                onChange={(v) => updateRow(idx, { name: v })}
                kind={r.kind}
                namesByKind={namesByKind}
                placeholder={t('settings.ingredient')}
                duplicate={duplicateRowIds.has(r.id)}
              />
```

Import it: `import { IngredientNameInput } from '@/components/recipe/IngredientNameInput';`

- [ ] **Step 7: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/RecipeEditor.tsx src/lib/i18n.ts
git commit -m "fix(recipe): lossless save, stable row keys, name picker

Rows the baker did not touch now save their exact stored percentage.
Rows key by a stable id, so deleting one no longer leaves the inputs
below it showing the previous row's values. And startEdit takes the
bread's own size rather than whatever the grams calculator was showing."
```

---

### Task 6: `CopyRecipeFlow` — source picker and flour step

**Files:**
- Create: `src/components/recipe/CopyRecipeFlow.tsx`
- Modify: `src/components/RecipeEditor.tsx` (empty state + seed path)

**Interfaces:**
- Consumes: `GroupRecipe`, `SeedRow` from Task 5; `IngredientNameInput` from Task 4.
- Produces:
  ```ts
  export function CopyRecipeFlow(props: {
    sources: GroupRecipe[];
    namesByKind: Record<IngredientKind, string[]>;
    onCancel: () => void;
    onDone: (rows: SeedRow[]) => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the flow**

```tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useT } from '@/hooks/useLang';
import { IngredientNameInput } from './IngredientNameInput';
import { groupByKind, kindLabel, type IngredientKind } from '@/lib/recipe';
import type { GroupRecipe, SeedRow } from '@/components/RecipeEditor';

/**
 * The two steps between "copy from" and the editor. It writes nothing: it hands
 * back seed rows and the editor stays the only thing that saves, so backing out
 * anywhere leaves no half-made recipe behind.
 */
export function CopyRecipeFlow({
  sources,
  namesByKind,
  onCancel,
  onDone,
}: {
  sources: GroupRecipe[];
  namesByKind: Record<IngredientKind, string[]>;
  onCancel: () => void;
  onDone: (rows: SeedRow[]) => void;
}) {
  const t = useT();
  const [source, setSource] = useState<GroupRecipe | null>(null);
  const [flours, setFlours] = useState<{ name: string; pctOfFinished: number; pctOfFlour: number }[]>([]);
  const [merged, setMerged] = useState(false);
  const [original, setOriginal] = useState<typeof flours>([]);

  function pick(s: GroupRecipe) {
    const f = s.ingredients
      .filter((i) => i.kind === 'flour')
      .map((i) => ({ name: i.name, pctOfFinished: i.pctOfFinished, pctOfFlour: i.pctOfFlour }));
    setSource(s);
    setFlours(f);
    setOriginal(f);
    setMerged(false);
  }

  function mergeFlours() {
    // Sum, don't average: a variation that swaps a 50/50 blend for one flour
    // uses the same total flour, so the dough must not change weight.
    setFlours([
      {
        name: flours[0]?.name ?? '',
        pctOfFinished: flours.reduce((s, f) => s + f.pctOfFinished, 0),
        pctOfFlour: flours.reduce((s, f) => s + f.pctOfFlour, 0),
      },
    ]);
    setMerged(true);
  }

  function unmergeFlours() {
    setFlours(original);
    setMerged(false);
  }

  function done() {
    if (!source) return;
    const nonFlour = source.ingredients.filter((i) => i.kind !== 'flour');
    const rows: SeedRow[] = [
      ...flours.map((f, i) => ({
        name: f.name.trim(),
        kind: 'flour' as IngredientKind,
        pctOfFinished: f.pctOfFinished,
        sortOrder: i,
      })),
      ...nonFlour.map((i, n) => ({
        name: i.name,
        kind: i.kind,
        pctOfFinished: i.pctOfFinished,
        sortOrder: flours.length + n,
      })),
    ];
    onDone(rows);
  }

  // STEP 1 — which recipe
  if (!source) {
    return (
      <div className="space-y-2">
        <div className="text-sm font-medium text-muted-foreground">{t('settings.copy_pick_source')}</div>
        {sources.length === 0 ? (
          <Card className="bg-muted/30 text-center py-3">
            <p className="text-xs text-muted-foreground">{t('settings.copy_no_sources')}</p>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {sources.map((s) => (
              <button
                key={s.breadTypeId}
                onClick={() => pick(s)}
                className="w-full flex items-baseline justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-start hover:bg-muted/50"
              >
                <span className="font-medium text-sm">{s.breadTypeName}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {s.ingredients.length} {t('settings.ingredients_count')}
                  {s.hydrationPct != null && ` · ${t('settings.hydration')} ${s.hydrationPct}%`}
                </span>
              </button>
            ))}
          </div>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>{t('payments.cancel')}</Button>
      </div>
    );
  }

  // STEP 2 — which flour
  const passthrough = groupByKind(
    source.ingredients.filter((i) => i.kind !== 'flour').map((i) => ({ ...i, sortOrder: i.sortOrder }))
  );

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-muted-foreground">{t('settings.copy_flours_title')}</div>

      <div className="space-y-2">
        {flours.map((f, idx) => (
          <div key={idx} className="grid grid-cols-[3.5rem_1fr] gap-2 items-center">
            <span className="text-sm font-bold tabular-nums text-muted-foreground">
              {f.pctOfFlour.toFixed(0)}%
            </span>
            <IngredientNameInput
              value={f.name}
              onChange={(v) => setFlours((prev) => prev.map((x, i) => (i === idx ? { ...x, name: v } : x)))}
              kind="flour"
              namesByKind={namesByKind}
            />
          </div>
        ))}
      </div>

      {original.length > 1 && (
        <Button size="sm" variant="ghost" onClick={merged ? unmergeFlours : mergeFlours}>
          {merged ? t('settings.copy_unmerge_flours') : t('settings.copy_merge_flours')}
        </Button>
      )}

      <div className="rounded-md bg-muted/40 p-2 text-xs space-y-0.5">
        <div className="text-muted-foreground">{t('settings.copy_flours_hint')}</div>
        <div className="flex flex-wrap gap-x-2 text-muted-foreground tabular-nums">
          {passthrough.flatMap((g) =>
            g.items.map((i) => (
              <span key={`${g.kind}-${i.name}`}>
                {i.name} {i.pctOfFlour.toFixed(0)}%
              </span>
            ))
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          disabled={flours.some((f) => !f.name.trim())}
          onClick={done}
        >
          {t('settings.copy_continue')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSource(null)}>
          {t('settings.copy_back')}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the entry point into `RecipeEditor`**

Export the seed type and add the copy state. Near `GroupRecipe`:

```ts
export interface SeedRow {
  name: string;
  kind: IngredientKind;
  /** Exact, carried from the source — never re-derived from a rounded display. */
  pctOfFinished: number;
  sortOrder: number;
}
```

Add `const [copying, setCopying] = useState(false);` beside the other state, and the seed path beside `startCreate`:

```ts
  /** Land copied rows in the editor at THIS bread's weight, not the source's. */
  function seedFromCopy(seed: SeedRow[]) {
    const weight = defaultReferenceWeight ?? 1000;
    setRefWeight(String(weight));
    setRows(
      seed.map((s) => ({
        id: newRowId(),
        name: s.name,
        kind: s.kind,
        grams: String(Math.round((s.pctOfFinished * weight) / 100)),
        sortOrder: s.sortOrder,
        // dirty:false is what makes the copy lossless — the grams above are for
        // the eye, and save() will send these percentages instead. Renaming a
        // flour does not touch its quantity, so a renamed row stays clean too.
        originalPctOfFinished: s.pctOfFinished,
        dirty: false,
      }))
    );
    setCopying(false);
    setEditing(true);
  }
```

In the STATE A (no recipe) block, render the flow when `copying`, and add the button:

```tsx
  if (!recipe) {
    return (
      <div className="border-t border-border pt-3 space-y-2">
        <div className="text-sm font-medium text-muted-foreground">{t('settings.recipe')}</div>
        {copying ? (
          <CopyRecipeFlow
            sources={sources}
            namesByKind={namesByKind}
            onCancel={() => setCopying(false)}
            onDone={seedFromCopy}
          />
        ) : (
          <Card className="bg-muted/30 text-center py-3 space-y-2">
            <p className="text-xs text-muted-foreground">{t('settings.no_recipe')}</p>
            <div className="flex gap-2 justify-center">
              <Button size="sm" variant="outline" onClick={startCreate}>
                <Plus className="h-3.5 w-3.5" />
                {t('settings.set_recipe')}
              </Button>
              {/* Only where there is no recipe to destroy. Replacing one is what
                  edit and delete are for; a silent overwrite behind a copy
                  button is a trap. */}
              {sources.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setCopying(true)}>
                  <Copy className="h-3.5 w-3.5" />
                  {t('settings.copy_recipe')}
                </Button>
              )}
            </div>
          </Card>
        )}
      </div>
    );
  }
```

Add to the lucide import on line 10: `Copy`. Add `import { CopyRecipeFlow } from '@/components/recipe/CopyRecipeFlow';`

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: both clean. A circular import between `RecipeEditor` and `CopyRecipeFlow` is type-only (`import type`) in one direction, which TypeScript erases — if the build complains, move `GroupRecipe` and `SeedRow` into `src/components/recipe/types.ts` and import from there in both.

- [ ] **Step 4: Commit**

```bash
git add src/components/recipe/CopyRecipeFlow.tsx src/components/RecipeEditor.tsx
git commit -m "feat(recipe): copy a recipe from another bread

Source picker, then a flour step where you name this bread's flour and
can merge a blend into one. Non-flour rows cross over untouched, and
every row arrives clean so an unedited copy stores the source's
percentages bit-for-bit."
```

---

### Task 7: End-to-end verification against live data

**Files:** none modified — this task proves the feature.

- [ ] **Step 1: Render the editor's copy flow**

Start the dev server on a free port and confirm the new route and the empty state both respond:

```bash
pkill -f "next dev"; (npx next dev -p 3120 > /tmp/dev.log 2>&1 &); sleep 15
curl -s http://localhost:3120/api/recipes -o /dev/null -w '%{http_code}\n'
```
Expected: `401` — the endpoint is behind `withGroup`, so an unauthenticated curl proving it is *guarded* is the correct result. An anonymous `200` is a bug; stop and fix the auth wrapper.

- [ ] **Step 2: Confirm the packing sheet still agrees**

The print sheet reads recipes through `aggregateRecipesForOrders`, which is untouched — but the atomic write changed how rows land. Mint a print token and render:

```bash
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config -e "import('./src/lib/export-token').then(m=>console.log(m.signExportToken(1,7200)))"
curl -s "http://localhost:3120/print/orders?token=<TOKEN>&d=2026-07-24" | grep -c 'kind-name'
```
Expected: `2` — the `לישה` block still renders its קמח group heading, so the recipe still reads correctly after the write path changed.

- [ ] **Step 3: Full gate**

Run: `pkill -f "next dev"; npx tsc --noEmit && npx next build`
Expected: both clean, route table lists `ƒ /api/recipes`.

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 Copy flow — picker, flour step, merge, target weight | 6 |
| §2 Lossless save — API contract | 3 (steps 1-2) |
| §2 Lossless save — editor sends pct | 5 (step 4) |
| §3 Ingredient name picker — endpoint | 2 |
| §3 Ingredient name picker — component | 4 |
| §3 Duplicate-name guard | 3 (step 2, server) + 5 (step 5, client) |
| §4 Atomic save | 3 (step 3) |
| §5 Row-key fix | 5 (step 2) |
| §6 `startEdit` weight | 5 (step 3) |
| Verification | 1 (step 2), 3 (step 6), 7 |

No gaps.

**Type consistency:** `SeedRow` and `GroupRecipe` are declared once in Task 5 and imported by Task 6. `RecipeEntry`/`entryGrams` are declared in Task 1 and consumed only by Task 3. `namesByKind` is `Record<IngredientKind, string[]>` in Tasks 2, 4, 5 and 6 alike.

**Known risk, flagged rather than hidden:** Task 3's CTE relies on the Postgres enum being named `ingredient_kind`; Task 3 Step 4 verifies this before the code ships. Task 6 Step 3 names the fallback if the type-only circular import trips the bundler.
