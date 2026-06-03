-- Per-group flat surcharge added to a line item's unit price when it has ≥1 addition.
-- Pure additive; default 0 preserves existing pricing.

ALTER TABLE "groups" ADD COLUMN "additions_surcharge" numeric(10, 2) DEFAULT '0' NOT NULL;
