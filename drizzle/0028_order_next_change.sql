-- What the next occurrence of a recurring order should change, saved on the
-- open order and applied once when that order is delivered. Null on every
-- existing row, which clones exactly as before.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "next_change" jsonb;
