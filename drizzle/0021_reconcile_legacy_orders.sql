-- One-off reconciliation of two legacy data problems. Both are historical
-- artefacts of features that arrived after the orders they affect.

-- 1. Delivered ASAP orders never got a delivery date: resolveDeliveryDate()
-- returns null for 'asap', and nothing filled it in on delivery. Postgres sorts
-- NULLs last, so these sat at the bottom of every list no matter how old they
-- were. The charge row is written at the moment of delivery, so its timestamp is
-- the best surviving evidence of when the order actually went out; where there
-- is no charge row, the status flip (updated_at) is the next best thing. Dates
-- are resolved in Asia/Jerusalem — a late-evening delivery would otherwise land
-- on the previous day in UTC.
UPDATE "orders" o
SET "delivery_date" = COALESCE(
  (
    SELECT (p."created_at" AT TIME ZONE 'Asia/Jerusalem')::date
    FROM "payments" p
    WHERE p."order_id" = o."id" AND p."payment_type" = 'charge'
    ORDER BY p."id"
    LIMIT 1
  ),
  (o."updated_at" AT TIME ZONE 'Asia/Jerusalem')::date
)
WHERE o."delivery_date" IS NULL AND o."order_status" = 'delivered';--> statement-breakpoint

-- 2. `orders.paid` was left false on orders the customer has since settled
-- through the running balance. The ledger is the source of truth for money and
-- says these are square: each of these customers' payments now cover their
-- charges in full. Reconciled per customer with the newest order absorbing any
-- remaining debt, which leaves exactly one genuinely unpaid order (#34, ₪30,
-- משפ׳ ציטרין) and #8 untouched — that one was delivered but never charged to
-- the ledger at all, so it needs a person, not a rule.
UPDATE "orders" SET "paid" = true
WHERE "id" IN (10, 14, 17, 26, 38, 41, 45, 46) AND "paid" = false;
