-- Catch up the paid flags that a customer-level payment stranded.
--
-- Money entered against the customer rather than an order landed in the ledger
-- and stopped there, so the delivery it covered stayed flagged unpaid and the
-- daily nudge kept chasing someone already square. `settleCoveredOrders` closes
-- that from this deploy on; this clears what built up before it.
--
-- Deliberately narrow: only customers whose balance is fully square (>= 0), so
-- there is no guessing about which of several open orders a partial payment
-- reached. Orders with no charge row are skipped — the balance has never heard
-- of them, so nothing in it can have covered them. A customer still in debt is
-- left exactly as it is: today that is #34 (משפ׳ ציטרין, -30), a real debt.
UPDATE "orders" o
SET "paid" = true
WHERE o."order_status" = 'delivered'
  AND o."paid" = false
  AND EXISTS (
    SELECT 1 FROM "payments" p
    WHERE p."order_id" = o."id" AND p."payment_type" = 'charge'
  )
  AND (
    SELECT COALESCE(SUM(p2."amount"), 0) FROM "payments" p2
    WHERE p2."customer_id" = o."customer_id" AND p2."group_id" = o."group_id"
  ) >= 0;
