-- Ingredient cost book: what a kilo of each ingredient costs, per group.
-- Purely additive — nothing reads these columns until the costs screen ships.
CREATE TABLE IF NOT EXISTS "ingredient_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"kind" "public"."ingredient_kind" NOT NULL,
	"price_per_kg" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ingredient_prices" ADD CONSTRAINT "ingredient_prices_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ingredient_prices_group_name_kind_idx" ON "ingredient_prices" USING btree ("group_id","name","kind");--> statement-breakpoint
-- מחמצת has no invoice price: it is fed from a flour the baker picks, at a
-- hydration, and part of it is discarded between feeds. Null flour means
-- "not configured" — starter then reads as unpriced rather than free.
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "starter_flour_name" varchar(100);--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "starter_hydration_pct" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "starter_waste_factor" numeric(4, 2) DEFAULT '1.50' NOT NULL;
