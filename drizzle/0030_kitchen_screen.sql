-- Kitchen screen: a phone paired by a one-time code shows the coming print
-- sheets. The version is signed into each paired screen's cookie, so bumping it
-- disconnects them all. A pairing code is stored only as its SHA-256.
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "kitchen_key_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "kitchen_pair_code_hash" varchar(64);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "kitchen_pair_expires_at" timestamp with time zone;
