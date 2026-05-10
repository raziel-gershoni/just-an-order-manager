-- Refactor: per-type sizes -> global per-group sizes + per-type opt-in junction.
-- See plan: /Users/razielgershoni/.claude/plans/fluffy-foraging-neumann.md

-- 1. Add new columns to bread_sizes (group_id nullable temporarily, is_default with default)
ALTER TABLE "bread_sizes" ADD COLUMN "group_id" integer;--> statement-breakpoint
ALTER TABLE "bread_sizes" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- 2. Backfill group_id from each row's parent type
UPDATE "bread_sizes" bs
SET "group_id" = bt."group_id"
FROM "bread_types" bt
WHERE bs."bread_type_id" = bt."id";--> statement-breakpoint

-- 3. Lock down group_id and add its FK
ALTER TABLE "bread_sizes" ALTER COLUMN "group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bread_sizes" ADD CONSTRAINT "bread_sizes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- 4. Junction table (created empty; user fills via new UI)
CREATE TABLE "bread_type_sizes" (
	"bread_type_id" integer NOT NULL,
	"bread_size_id" integer NOT NULL,
	"price_override" numeric(10, 2),
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bread_type_sizes_bread_type_id_bread_size_id_pk" PRIMARY KEY("bread_type_id","bread_size_id")
);--> statement-breakpoint
ALTER TABLE "bread_type_sizes" ADD CONSTRAINT "bread_type_sizes_bread_type_id_bread_types_id_fk" FOREIGN KEY ("bread_type_id") REFERENCES "public"."bread_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bread_type_sizes" ADD CONSTRAINT "bread_type_sizes_bread_size_id_bread_sizes_id_fk" FOREIGN KEY ("bread_size_id") REFERENCES "public"."bread_sizes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- 5. Repoint order_items.bread_size_id to the dedup winner of each cluster
--    (MIN id per group/name/weight). Items currently referencing different
--    rows that share the same physical size collapse to one survivor.
UPDATE "order_items" oi
SET "bread_size_id" = (
  SELECT MIN(bs2."id") FROM "bread_sizes" bs2
  WHERE bs2."group_id" = (SELECT "group_id" FROM "bread_sizes" WHERE "id" = oi."bread_size_id")
    AND bs2."name" = (SELECT "name" FROM "bread_sizes" WHERE "id" = oi."bread_size_id")
    AND bs2."weight_grams" IS NOT DISTINCT FROM (SELECT "weight_grams" FROM "bread_sizes" WHERE "id" = oi."bread_size_id")
)
WHERE "bread_size_id" IS NOT NULL;--> statement-breakpoint

-- 6. Delete every bread_size that no order_item points at
--    (survivors = the deduped set actually used in history)
DELETE FROM "bread_sizes"
WHERE "id" NOT IN (
  SELECT DISTINCT "bread_size_id" FROM "order_items" WHERE "bread_size_id" IS NOT NULL
);--> statement-breakpoint

-- 7. Drop the now-redundant per-type column (and its FK first)
ALTER TABLE "bread_sizes" DROP CONSTRAINT IF EXISTS "bread_sizes_bread_type_id_bread_types_id_fk";--> statement-breakpoint
ALTER TABLE "bread_sizes" DROP COLUMN "bread_type_id";--> statement-breakpoint

-- 8. Drop the now-dead price column from bread_types
ALTER TABLE "bread_types" DROP COLUMN "price";
