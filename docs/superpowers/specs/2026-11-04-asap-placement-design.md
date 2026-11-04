# בהקדם placement switch and kitchen recipe switch: design

Approved in chat on 2026-11-04.

## Goal

One switch decides where open בהקדם orders (orders with no delivery date) appear, the same way in
every view that shows orders by day. They either form their own group just before today, or they
are part of today. A second switch shows or hides the mixing weights on the kitchen screen.

## Decisions (owner)

- **One switch per bakery: "בהקדם בתוך היום".**
  - Owner or manager only.
  - **Off after deploy**, because the baker prefers them separate.
- **Off (separate).**
  - בהקדם is its own group, placed **immediately before today**, in full.
  - A long בהקדם list pushes today down. The owner accepted this for now: "let it stay simple, we
    will see how it works out as we grow".
- **On (inside today).**
  - They are part of today: the list, the counts, the loaf totals and the mixing weights.
  - Inside today they come **first, oldest first**, then today's own orders. Each one is labelled
    בהקדם.
- **Weights in separate mode.** The בהקדם group has a loaf count but no mixing weights. A dough is
  mixed for one day's bake, which is the print view's existing rule for undated sheets.
- **Kitchen recipe switch: "הצג מתכון".**
  - On by default.
  - Hides only the לישה (mixing weights) section on the kitchen screen. The baking count and the
    bags stay.
  - Lives in the מסך מטבח settings card. The print view and the baker tab are not affected.
- **Not part of this:** folding or collapsing groups, a jump strip, a per-user setting.

## Definitions

- **בהקדם order:** `delivery_date IS NULL` and status not `delivered` or `cancelled`.
  - Marking one delivered stamps today's date (`src/lib/order-status.ts`).
  - From then on it is an ordinary order of today, in both modes.
- **Today:** the bakery's Israel day on the server (`todayStr()`), never the device clock.
- **Undated closed orders** (cancelled, or old delivered rows with no date) are never part of
  today. Lists that show closed orders keep them in a בהקדם group, placed by the separate rule.

## The placement rule

**Separate (off).**
- The בהקדם group sits immediately before today's group, in reading order.
- If today has no group, it sits where today's group would be.
- Lists that read soonest first: past-due days, בהקדם, today, tomorrow, and so on.
- Lists that read latest first (history): … tomorrow, בהקדם, today, yesterday, and so on.

**Inside today (on).**
- Open undated orders join today's group, first.
- If no order is dated today, today's group is created to hold them.

**Order within בהקדם:** oldest first (by order number), in every view.

## Views

| View | Separate (off) | Inside today (on) |
|---|---|---|
| Home screen | בהקדם section, with its loaf total, before the היום section. The top loaf card counts today only. | Undated orders lead today's list, labelled; the loaf card counts them. |
| Orders tab (all three tabs), customer card history | בהקדם group just before today | Inside today's group, first, labelled |
| משלוחים היום | בהקדם group just before today | Inside today's group, first, labelled |
| Baker tab | On today: a בהקדם card above today's weights, loaf count per bread, no weights | Today's counts and weights include them |
| Kitchen screen | בהקדם card first (loaf count and bags, no weights), then today | Inside today, first, labelled |
| Print, היום sheet | A בהקדם sheet, then today's sheet | Inside today's sheet, first, labelled |
| Bot `/today` | בהקדם section first, then today's list, total and weights | One list, undated first and tagged; the total and weights include them |
| Bot `/week` | בהקדם bucket first, then each day; the weights cover dated orders only | Undated orders join today's bucket, first; the weights include them |
| Morning baking message | בהקדם section first, then today's; sent when either has orders | Today includes them, weights too |

**Details per view**

1. **Home screen** (`src/app/miniapp/page.tsx`, `src/app/api/dashboard/route.ts`).
   - The API returns three things:
     - `todayOrders`, which in on mode also holds the open undated orders, first;
     - `asapOrders`, filled in off mode and empty in on mode;
     - `totalPendingLoaves`, the today total for the mode.
   - Every row carries its `deliveryDate`.
   - The top loaf card hides when today is empty.
   - The "nothing scheduled" hint shows only when today, בהקדם and the coming days are all empty.
2. **Orders tab and customer card** (`src/app/miniapp/orders/page.tsx`,
   `src/app/miniapp/customers/[id]/page.tsx`, `src/app/api/orders/route.ts`).
   - The API also returns `today` and `asapInToday`.
   - The pages group the rows with the shared grouping helper.
   - The active tab reads soonest first; the history tabs and the customer card read latest first.
3. **משלוחים היום** (`src/app/miniapp/deliveries/page.tsx`, `src/app/api/deliveries/route.ts`).
   - Same as the Orders tab, reading soonest first.
   - The delivery badge on the home screen still counts every open delivery.
4. **Baker tab** (`src/app/miniapp/baker/page.tsx`, `src/app/api/baker/route.ts`).
   - Today comes from the server. A request without a date gets today, and the response carries
     `today`.
   - For today's date, the API does one of two things:
     - in on mode, it adds the open undated orders to today's orders;
     - in off mode, it returns `asap: { name, loaves }[]`, shown above the weights as a בהקדם card.
5. **Kitchen screen** (`src/lib/kitchen-sheet.ts`, `src/components/kitchen/KitchenSheets.tsx`).
   - In off mode, the בהקדם card comes back first: `buildPrintSheet(groupId, null, { undatedOnly:
     true })`. Today then holds only its dated orders.
   - In on mode, today is `buildPrintSheet(groupId, today, { withUndated: true })`.
   - `KitchenData` carries `showRecipe`. When it is off, no card shows the לישה section.
6. **Print** (`src/app/print/orders/page.tsx`).
   - This applies only when the sheet's date is today: the היום preset, or a picked date that is
     today.
   - In on mode, today's sheet takes them in.
   - In off mode, a בהקדם sheet (heading, counts, baking count, bags) prints before today's sheet.
   - Other dates and כל הפעילות are unchanged.
7. **Bot `/today` and `/week`** (`src/app/api/bot/route.ts`) and the **morning baking message**
   (`src/app/api/cron/morning-reminder/route.ts`, `sendMorningSummary` in
   `src/lib/notifications.ts`).
   - In off mode they add a בהקדם section before today, with its own loaf total.
   - In on mode, today's list, total and weights include the undated orders, which are tagged
     בהקדם.
   - `/today` replies "no orders" only when both are empty. The morning message is skipped only
     when both are empty.

**Unchanged:**
- the pending-approval nudge, which already labels בהקדם;
- the print view's כל הפעילות;
- the order detail page;
- the customer temperature;
- the money reports;
- the recurring reminders;
- the home screen's pending and delivery badges.

## Small fixes in the same code

- "בהקדם" is hard-coded in `src/lib/order-grouping.ts` and `src/components/print/SheetParts.tsx`.
  Both move to `t('delivery.asap')`.
- In the new-order Telegram message (`notifyNewOrder`), an undated order's date line reads בהקדם.
  Today the line is missing.
- `/week` day headings use `formatWeekdayShort` instead of the raw `yyyy-MM-dd`. The dead `'ASAP'`
  fallback goes.
- **Baker tab:** today comes from the server, not `format(new Date())`. The "היום" button's text
  comes from the strings file.

## Shared code (one code path)

- **Columns on `groups`:**
  - `asap_in_today boolean NOT NULL DEFAULT false`;
  - `kitchen_show_recipe boolean NOT NULL DEFAULT true`.
  - Migration `0032`.
- **`src/lib/asap.ts` (server only):**
  - `getOrderDisplay(groupId)` returns `{ asapInToday, kitchenShowRecipe }`;
  - `openUndated()` is the SQL condition for a בהקדם order;
  - `todayCondition(today, asapInToday)` is `delivery_date = today`, or that OR `openUndated()`.
  - The home screen, baker API, bot `/today` and `/week`, morning message and `buildPrintSheet` all
    use these. None keeps its own copy.
- **`buildPrintSheet` options:** `withUndated` (today with the undated orders) and `undatedOnly`
  (the בהקדם sheet, date null).
- **`src/lib/order-grouping.ts`:**
  - `groupByDeliveryDate(orders, lang, { today, asapInToday, order: 'soonest' | 'latest' })`
    applies the placement rule.
  - A row is labelled when its `deliveryDate` is null.
- **API responses** that feed grouped lists also return `today` and `asapInToday`.
- **`PATCH /api/groups/[id]`** takes `asapInToday` and `kitchenShowRecipe`, owner or manager only.
  `GET` already returns the row.
- **Kitchen refresh:** the settings PATCH writes through `src/db`. The write hook marks the
  kitchen's saved copy stale, so the phone updates within about 30 s. The cache key doesn't change.

## UI

- **Settings, main page:** a new בהקדם section, owner or manager only.
  - It holds the switch "להציג בתוך היום" and a one-line hint saying what each position does.
  - The switch saves on tap and is optimistic: on failure it reverts and shows a toast, like the
    recurring-reminders switch.
- **מסך מטבח card:** the switch "הצג מתכון" and a one-line hint. It saves on tap.
- **The בהקדם label inside today** uses the existing wording:
  - in the mini app, before the row's items line;
  - on the sheets, in the bag's details line;
  - in Telegram, as a tag on the line.
- All new copy goes in `src/lib/i18n.ts`, written as native Hebrew.

## Testing

All testing is offline. Nothing reaches the owner's database.

- **PGlite harness with every migration applied**, for each server query in both modes:
  - the home screen;
  - the baker API;
  - bot `/today` and `/week`, with grammy's API intercepted;
  - the morning message, with its sends intercepted;
  - print;
  - the kitchen screen.
- **A pure test of the grouping helper:** both directions, no today group, closed undated orders.
- **Render checks:** the kitchen and print markup, and both switches.
- **Mutation testing:** undo each part of the fix and confirm the test catches it.
- **Gate:** tsc, eslint and `next build` with the fake database.
- **The owner tests manually in prod:**
  - flip the switch;
  - check the home screen, the Orders tab, the kitchen phone, print and `/today`.

## Caveats

- An undated order marked delivered gets today's date. In off mode it moves from בהקדם into today
  in the views that keep delivered orders: the home screen's today, the kitchen screen, print, the
  baker tab and `/today`.
- Open orders dated in the past are unchanged by this. They keep their own earlier groups in the
  Orders tab, and stay off the kitchen screen, print and the home screen's today.
- The morning message goes out once a day. A flip after it was sent shows from the next morning.
- Bot commands use the user's first bakery, as they do today.
