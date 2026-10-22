# Paid in advance — Design

**Date:** 2026-10-22
**Status:** approved in chat (the owner answered "usually for the specific
order", the case this design covers); autonomous build

The owner asked to "mark an order paid even before it was delivered". Today
payment can only be recorded once an order is delivered (`/orders/[id]/pay`
refuses anything else), so money a customer sends ahead (Bit, on ordering)
goes on the tab as loose credit. The order keeps reading "לא שולם" until
delivery: the list stamp, "לתשלום ₪120" on the print sheet, and "₪120 · מסר
ונגבה" on the driver's screen, which invites collecting twice. The bot also
asks "האם ההזמנה שולמה?" after delivery, and its ✅ writes the money a second
time.

## Decisions

| Question | Decision |
|---|---|
| What a prepayment is | An ordinary `payment` row linked to the order (`order_id`) and written while the order is open. No schema change. A linked payment written before the order's charge is a prepayment by definition. |
| The charge | Still written once, at delivery, at the price of that moment. A prepayment never writes it. The income report, the weekly turnover and the "charged when delivered" rule stay true. |
| The paid flag | For an open order, `paid` mirrors its own money: true when its linked payments cover its current total. It is recomputed after a prepayment, its undo, and every edit. |
| Who | Everyone but drivers, as with every other payment control. |
| Several weeks ahead | Not built. The owner said customers pay for the specific order. Tab credit keeps working as today. |

Rejected: lifting the "must be delivered" guard on the existing pay action.
That action writes the charge first, so the order would be counted in the
month it was paid, the charge would stay at the old price after an edit (no
code updates a charge), and a cancelled order would still carry it.

## Behaviour

- **Order page, open order.** Under the total: a "שולם מראש" button. It opens
  an amount box filled with what is still due; "רשום ₪120" records it. Then
  the line reads "✓ שולם מראש ₪120 · ביטול". "ביטול" (confirmed) deletes the
  prepayment, for mistakes. The baker and the owner get the 💰 message, which
  names the order instead of calling the money credit.
- **Total grows after paying.** The flag drops, and the line reads "שולם מראש
  ₪100 · נותר ₪20", with "רשום ₪20" for a customer who sends the rest before
  delivery. The deliver card, the driver, the bot and the print sheet ask only
  for the ₪20. **Total shrinks:** the difference becomes credit at delivery.
- **Delivery.** A paid order's "נמסר" delivers at once, without the payment
  card. The bot asks nothing after delivering a paid order. Otherwise every
  "paid in full" path records what is still due, not the total: the driver's
  "מסר ונגבה", the bot's ✅ and the unpaid nudge's ✅, and the nudge quotes it.
- **Driver.** Unchanged screen. A paid order shows "מסולק" with only "נמסר";
  a part-paid one shows the amount still due.
- **Cancel.** The money stays with the customer as credit. The cancel
  confirmation says so, the cancelled order shows it, and the freed credit
  settles any delivered orders it now covers.
- **Skip a week.** The prepayment moves to the next order, which shows "שולם
  מראש" there; the skip confirmation says so. If the next order could not be
  made, the money stays as credit, as with cancel.
- **Recurring.** Each occurrence is paid on its own; the next order starts
  unpaid (unchanged).

## Ledger rules that change

- **A second payment on one order.** The model was one payment row per order:
  a second tap of the same amount is a retry, a different amount is refused
  ("already"). A prepaid order needs a second row for the rest, and that rest
  can equal the first amount (two loaves paid, two added). New rule: a second
  row is written only when it pays exactly what is still due. Otherwise it is
  a retry ("duplicate") only when the order is already covered and a payment
  of that amount was made at the same stage (at the door, only rows written
  after the charge count — a match against the prepayment is the customer
  paying twice on a stale screen). Anything else is refused out loud
  ("already"), and a refused payment leaves the paid flag as it was. While
  money is still due a same-amount payment can't be told from a new one (₪50,
  then another ₪50), and a warning beats a quiet loss. The one remaining
  ambiguity: a retry of a first payment of exactly half the total is written
  twice.
- **"In full" means what is still due.** `recordOrderPayment('paid')` with no
  amount (the bot's ✅) records the remainder, or nothing if nothing is due.
- **The ✅ undo (📝 / "לא שולם")** only takes back a row written after the
  charge, i.e. at or after delivery, and only when the order's own payments
  exactly cover it. A prepayment is never undone from Telegram. An order its
  own prepayment covers answers "covered".
- **Settling from the tab** (`settleCoveredOrders`) leaves out money held by
  open orders (their linked rows), and an order with part of its total
  already paid absorbs only the rest. Without this, ₪120 paid ahead for
  Friday would mark last week's unpaid delivery paid, and both would read
  "שולם" while ₪80 is owed. The same free balance decides "covered", is what
  the order page's pay card shows and offers "קזז מקרדיט" on (the balance
  route returns it as `available`), and gates the `credit` action on the
  server, which refuses ("short") when it doesn't cover the order.
- **Undo of a prepayment** drops the flag first, then deletes only while the
  order is open, so a delivery landing in between keeps the money and the
  order settles itself; the other way round a delivered order could read paid
  with its money gone.
- **Edits.** PATCH re-syncs the flag of an open order with linked payments.

## Untouched

Customer page balances and the dashboard debt list (raw ledger: a prepaid
customer shows the credit until delivery, as with tab credit today), the
payments page and POST /payments, income report, weekly summary, reminders,
next-change.

## Testing

No test runner, and the owner's database is off limits: the SQL and the
helpers run in the PGlite harness with every migration applied. Prepay, top
up, retry, undo; edit up and down; deliver paid and part-paid (charge at
delivery, flag, settle); the bot ✅ due and 📝 on a prepaid order; cancel
releasing credit and settling an older order; skip moving the money;
settle with a prepaid open order beside an unpaid delivered one. Screens as
static fixtures at phone width. `tsc`, `eslint`, `npx next build` (never
`npm run build`, which migrates production).
