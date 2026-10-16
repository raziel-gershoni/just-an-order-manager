# Recurring order: change from the next occurrence — Design

**Date:** 2026-10-16
**Status:** approved in chat ("go with your recommendation"); owner asked for an autonomous build

The owner asked for "a way to update a recurring order but only starting from
the next occurrence". A recurring chain always has one open order, and the next
one is cloned from it when it is marked delivered
(`createNextRecurringOrder`). Editing the open order therefore changes this
week and every week after; there is no way to leave this week alone.

## Decisions

| Question | Decision |
|---|---|
| Where the change lives | One nullable `jsonb` column, `orders.next_change`, on the open order. No second order row. |
| What it holds | Only the parts that differ, in three sections: **basket** (items, both pricing switches, custom total, pickup/delivery, fee, priced), **notes**, **schedule** (delivery type + first date). Absent section = take it from the order at delivery, as today. |
| When it applies | In `createNextRecurringOrder`, the one place a next occurrence is born, for the web, the bot and the driver alike. Used once: the clone's own `next_change` is null. |
| Pricing | At save, through the one engine (`resolveAndPriceOrderLines` → `priceOrderForWrite`). A basket whose pricing key matches the open order (or the saved change) copies that frozen pricing, so a notes/day/fee-only change never lifts a frozen price. Nothing is priced at delivery. |
| Labels | Name the date ("שינוי מ־30/10"), never "next time": right after Friday's delivery the open order already is next week's. |
| Entry point | A link next to "הפסק חזרה" on the order page; the existing order form in a "from DATE" mode. |

Rejected (critiqued in chat): asking a calendar-style scope question on every
save (friction, and a routine edit by one partner wipes the other's plan);
creating next week's order early (two rows per customer in every open-order
list, the morning approval nudge, the print sheet; plain edits quietly stop
carrying forward).

## Behaviour

- **Order page.** Under the recurring row: "שינוי מ־30/10 · הפסק חזרה" (not for
  drivers, open orders only). While a change is waiting, a card shows
  "מ־יום ו׳ 30/10" with what changes (items + total, the note, the day), ✎ to
  edit and ✕ to discard (confirmed).
- **Form, next mode** (`/miniapp/orders/new?edit=ID&next=1`). Prefilled from the
  saved change, otherwise from the order. Hint: this week's order stays as it
  is. No ASAP tile, no repeat checkbox. A line names the date the change starts.
  Save → `PUT /api/orders/[id]/next-change`. A save that differs in nothing
  stores null (and so also clears a waiting change).
- **Schedule.** The next occurrence's *week* stays; only the day moves.
  שבת/שבועי → the Friday of the week of the plain next date; תאריך מסוים → the
  picked date, after this order's date and not in the past. A Friday already
  planned is kept when the change is re-saved (recomputing it would move it a
  week on whenever this order runs late). At delivery the stored date rolls
  forward by whole weeks past max(today, this order's date), the same rule
  `nextRecurringDate` uses.
- **Plain edit while a change waits.** A hint at the top names it. Saving asks a
  question only when the edit touches a section the change also holds:
  "גם מ־30/10" (drop that section, so the edit carries forward as today) or
  "רק להזמנה הזו" (keep it). PATCH takes `dropNextChange: section[]`. The
  price pencil on the order page asks the same when a planned change holds the
  basket. When the edit moves this week's date the question names no date
  (the one known at load would be wrong).
- **Stop / ASAP / untick.** Clears the change. Kept hidden, it came back
  unannounced when the box was ticked again and overrode that same edit.
  "הפסק חזרה" asks first when a change is planned, and only then. Cancel ends
  the chain and the change with it (unchanged rule).
- **Delivery.** The clone re-reads `is_recurring` and `next_change` by id (the
  caller's row predates the delivered flip). If the change can't be written
  (e.g. a size hard-deleted since), the half-clone is cleaned up and the plain
  copy is made instead — only when the cleanup succeeded, so a failure never
  leaves two clones. The baker's renewal ping says "עם השינוי שתוכנן" or that it
  wasn't applied, and uses the effective notes and date.
- **Writes are guarded.** `next_change` is written only `WHERE id AND group AND
  is_recurring AND status NOT IN (delivered, cancelled)`; no row → 409, so a
  change saved after delivery is refused, never stranded.

## Existing bug fixed alongside

PATCH re-dated every שבת/שבועי order through `resolveDeliveryDate` on each save
(the form always sends `deliveryType`), and `getNextShabbatDate()` returns today
on a Friday — editing next week's fresh clone on delivery day moved it to today.
PATCH now keeps the stored date when both the old and the new type are
שבת/שבועי (one Friday rule under two labels) and the date is not in the past;
an overdue one still rolls to the coming Friday.

## Untouched

Lists, dashboard, print sheet, baker view, deliveries, nudges, reminders (this
week's reminder describes this week's order; next week's reads the clone, which
already has the change), the income report, the charge path.

## Testing

No test runner and no database may be touched: the SQL and the clone run in the
PGlite harness (all migrations applied) — save a change per section, deliver,
deliver again (N+2 copies N+1, the change is used once), the guarded write after
delivery, the fallback with a deleted size, a late delivery, the PATCH date fix,
`dropNextChange`. Screens as static fixtures at phone width. `tsc`, `eslint`,
`npx next build` (never `npm run build`, which migrates production).
