-- Which staff member works with each customer. Purely additive and nullable:
-- the customers that predate this column have no recorded provenance, so
-- "unassigned" is a real state rather than a guess. Not a visibility rule —
-- everyone in the group still sees every customer.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "handler_user_id" integer;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "customers" ADD CONSTRAINT "customers_handler_user_id_users_id_fk" FOREIGN KEY ("handler_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
