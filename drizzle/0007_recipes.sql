-- Bread recipes: per-type ingredient list stored as % of finished loaf weight.
-- Bake yield is implicit in the sum of percentages (no anchor stored).
-- Pure additive migration.

CREATE TYPE "ingredient_kind" AS ENUM('flour', 'water', 'salt', 'starter', 'other');--> statement-breakpoint

CREATE TABLE "bread_recipes" (
	"bread_type_id" integer PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "bread_recipe_ingredients" (
	"id" serial PRIMARY KEY NOT NULL,
	"bread_type_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"kind" "ingredient_kind" NOT NULL,
	"pct_of_finished" numeric(7, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint

ALTER TABLE "bread_recipes" ADD CONSTRAINT "bread_recipes_bread_type_id_bread_types_id_fk" FOREIGN KEY ("bread_type_id") REFERENCES "public"."bread_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bread_recipe_ingredients" ADD CONSTRAINT "bread_recipe_ingredients_bread_type_id_bread_recipes_bread_type_id_fk" FOREIGN KEY ("bread_type_id") REFERENCES "public"."bread_recipes"("bread_type_id") ON DELETE cascade ON UPDATE no action;
