-- Delivery route order: customers and the bakery's home address are geocoded
-- lazily and cached with the text that was looked up (a changed address is
-- looked up again). geo_query set with geo_lat null = Google said "no results".
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "geo_lat" double precision;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "geo_lng" double precision;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "geo_query" varchar(800);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "geo_rough" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "delivery_home_address" varchar(500);--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "home_geo_lat" double precision;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "home_geo_lng" double precision;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "home_geo_query" varchar(800);--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "home_geo_rough" boolean DEFAULT false NOT NULL;
