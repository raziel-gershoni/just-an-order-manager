-- Closes the one order 0021 deliberately left for a human.
--
-- 0021 skipped #8 because the per-order lookup (payments.order_id = 8) found no
-- charge, so it looked like a delivery that never entered the ledger. It had:
-- payments row 13 is a ₪20 charge dated the same day #8 was delivered, for
-- exactly its total, but written with order_id = NULL — one of twelve rows from
-- the older customer-level flow that carry no order link. With that charge
-- counted, the customer sits at ₪10 credit, so #8 is settled and only its flag
-- was stale: the same case as the eight 0021 already reconciled.
UPDATE "orders" SET "paid" = true WHERE "id" = 8 AND "paid" = false;
