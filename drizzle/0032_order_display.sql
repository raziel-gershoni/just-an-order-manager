ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "asap_in_today" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "kitchen_show_recipe" boolean DEFAULT true NOT NULL;
