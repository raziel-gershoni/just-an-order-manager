-- Kitchen screen Shabbat mode: the bakery's famcal city (null = off) and community,
-- and the times fetched from famcal, one row per bakery.
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "shabbat_city" varchar(64);--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "shabbat_community" varchar(16) DEFAULT 'sephardi' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shabbat_times" (
  "group_id" integer PRIMARY KEY NOT NULL REFERENCES "groups"("id"),
  "data" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
