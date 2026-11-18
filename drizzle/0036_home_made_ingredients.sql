-- Home-made ingredients (src/lib/cost.ts, src/lib/hydration.ts): each starter or
-- tangzhong has its own flour, liquid, hydration and waste, replacing the one
-- bakery-wide groups.starter_* setting. Those columns stay for now (the
-- deployment still serving during this migration reads them) and are dropped in
-- a later migration.
CREATE TABLE IF NOT EXISTS "home_made_ingredients" (
  "id" serial PRIMARY KEY NOT NULL,
  "group_id" integer NOT NULL REFERENCES "groups"("id"),
  "name" varchar(100) NOT NULL,
  "kind" "ingredient_kind" NOT NULL,
  "flour_name" varchar(100),
  "liquid_name" varchar(100) NOT NULL,
  "liquid_kind" "ingredient_kind" NOT NULL,
  "hydration_pct" integer NOT NULL,
  "waste_factor" numeric(4,2) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "home_made_ingredients_kind_check" CHECK ("kind" IN ('starter', 'other')),
  CONSTRAINT "home_made_ingredients_liquid_kind_check" CHECK ("liquid_kind" IN ('water', 'other')),
  CONSTRAINT "home_made_ingredients_hydration_check" CHECK ("hydration_pct" BETWEEN 1 AND 1000),
  CONSTRAINT "home_made_ingredients_waste_check" CHECK ("waste_factor" BETWEEN 1 AND 10)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "home_made_ingredients_group_name_kind_idx" ON "home_made_ingredients" ("group_id", "name", "kind");--> statement-breakpoint
ALTER TYPE "change_proposal_kind" ADD VALUE IF NOT EXISTS 'home_made';--> statement-breakpoint
-- One row per distinct starter name in a bakery's recipes, carrying the
-- bakery's old starter settings, so nothing priced today becomes unpriced.
INSERT INTO "home_made_ingredients" ("group_id", "name", "kind", "flour_name", "liquid_name", "liquid_kind", "hydration_pct", "waste_factor")
SELECT DISTINCT bt."group_id", bri."name", 'starter'::"ingredient_kind", g."starter_flour_name", 'מים', 'water'::"ingredient_kind", g."starter_hydration_pct", g."starter_waste_factor"
FROM "bread_recipe_ingredients" bri
JOIN "bread_types" bt ON bt."id" = bri."bread_type_id"
JOIN "groups" g ON g."id" = bt."group_id"
WHERE bri."kind" = 'starter'
ON CONFLICT DO NOTHING;
