-- Tangzhong is its own ingredient kind, home-made like starter. Home-made now
-- means kind starter or tangzhong; `other` is always a bought, typed-price
-- ingredient. The Neon migrator runs each statement on its own (no wrapping
-- transaction), so the new enum value is usable by the statements below it.
ALTER TYPE "ingredient_kind" ADD VALUE IF NOT EXISTS 'tangzhong';--> statement-breakpoint
ALTER TABLE "home_made_ingredients" DROP CONSTRAINT IF EXISTS "home_made_ingredients_kind_check";--> statement-breakpoint
-- Recipe rows that share a name with a home-made `other` entry of the same
-- bakery become tangzhong; any other `other` row (olives) stays `other`.
UPDATE "bread_recipe_ingredients" bri
SET "kind" = 'tangzhong'::"ingredient_kind"
FROM "bread_types" bt
WHERE bt."id" = bri."bread_type_id"
  AND bri."kind" = 'other'
  AND EXISTS (
    SELECT 1 FROM "home_made_ingredients" h
    WHERE h."group_id" = bt."group_id" AND h."name" = bri."name" AND h."kind" = 'other'
  );--> statement-breakpoint
UPDATE "home_made_ingredients" SET "kind" = 'tangzhong'::"ingredient_kind" WHERE "kind" = 'other';--> statement-breakpoint
ALTER TABLE "home_made_ingredients" ADD CONSTRAINT "home_made_ingredients_kind_check" CHECK ("kind" IN ('starter', 'tangzhong'));
