-- Move customers.phone (single varchar) -> customer_phones (one row per phone).
-- Existing phones become the first row per customer (sort_order = 0).

CREATE TABLE "customer_phones" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"phone" varchar(50) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "customer_phones" ADD CONSTRAINT "customer_phones_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Migrate existing phones (one row per customer that had one)
INSERT INTO "customer_phones" ("customer_id", "phone", "sort_order")
SELECT "id", "phone", 0
FROM "customers"
WHERE "phone" IS NOT NULL AND "phone" <> '';--> statement-breakpoint

-- Drop the old single-phone column
ALTER TABLE "customers" DROP COLUMN "phone";
