# Order again — Design

**Date:** 2026-10-27
**Status:** approved in chat ("yep and develop" on the short sketch); autonomous build

The owner asked whether an order can be cloned "if the client just wants the
same as last time". It couldn't: the weekly repeat copies a recurring order on
delivery, the customer card's "הזמנה חדשה" presets only the customer, and edit
changes the order itself.

## Behaviour

- **Order page, delivered or cancelled order:** an outline "הזמן שוב" button,
  last on the page (under the payment cards a delivered order may still need).
  Not for drivers, who don't create orders.
- **Customer card:** under the two quick actions, "כמו ההזמנה האחרונה" with the
  delivery day and the items summary of the order the customer placed most
  recently (by creation time), skipping cancelled ones. A cancelled order can
  still be ordered again from its own page. ("ההזמנה האחרונה", not "בפעם
  הקודמת": for a weekly customer it is the upcoming occurrence.)
- Both open the new-order form at `/miniapp/orders/new?from=<id>`: a new order
  (create mode), with a banner "הועתק מהזמנה #123 של יום ו׳ 16/10".

## What the copy carries

| Copied | Not copied |
|---|---|
| Customer (changeable), when still on the customer list | A customer deactivated since: the owner picks one (the form knows only listed customers' phones and city, which the WhatsApp checkbox and the fee go by) |
| Breads, sizes, additions, quantities, per-line "charge additions" | The date: a specific date is picked again; שבת/שבועי land on the coming Friday as for any new order |
| Delivery type (שבת / בהקדם / תאריך מסוים / שבועי) | The weekly repeat (starts off) |
| Pickup or delivery and an out-of-zone manual fee, while delivery is switched on in settings | Delivery when it is switched off (its card is hidden, so nothing could untick it) |
| Notes, deals and charge-additions flags (as the weekly repeat copies them) | Status, payments, the paid flag |
| The custom total, when the whole basket came across | The custom total when part of the basket didn't: it priced that basket |
| | Prices: the form and the server price the copy from today's catalog; an in-zone fee follows today's delivery settings |

"Notify the customer" starts on, as for any new order.

**Today's menu** (`copyLinesToMenu`, `src/lib/order-copy.ts`): a bread no
longer sold drops out; an addition no longer offered with it is left off; a
size no longer offered is cleared so the owner picks one (the save button waits
for it). Any of these adds a warning line to the banner: "חלק ממה שהוזמן אז
כבר לא בתפריט, ולכן לא הועתק" (with "וכך גם הסכום המותאם" when a custom total
was left off). If no bread is left, the basket starts empty ("אף אחד מהלחמים
בהזמנה ההיא כבר לא בתפריט") rather than with a bread nobody chose.

The city-based delivery suggestion that runs when a customer is picked is
held back until the owner picks a different customer, so the copy keeps its own
pickup or delivery choice. Opening the list ("שנה") and picking the same customer
back is not a change. After a change it runs as for any new order, from then on,
and the copied manual fee is cleared with it. For a customer deactivated since,
the hold lasts until a customer is picked, so the old fee never lands on them.

An order that can't be read (deleted, another bakery's) gives a toast and a
blank new order.

## Untouched

The server: `POST /orders` already validates and prices every line. Edit and
"from the next occurrence" modes, the weekly repeat.

## Testing

No test runner, and the owner's database is off limits. `copyLinesToMenu` is
checked offline (verbatim, bread gone, size gone, addition gone, legacy line
without a size, nothing left, a size enabled only for another bread), each check
failing with its rule removed. Screens rendered from the real pages with fixture
data at phone width, light and dark. `tsc`, `eslint`, `next build` (never
`npm run build`, which migrates production).
