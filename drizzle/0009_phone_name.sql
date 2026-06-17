-- Optional per-number contact name (nullable). Additive; existing rows unaffected.
ALTER TABLE "customer_phones" ADD COLUMN "name" varchar(255);
