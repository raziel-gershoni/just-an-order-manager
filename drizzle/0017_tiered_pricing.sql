-- Custom SQL migration file, put your code below! --
CREATE TABLE "bread_size_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"bread_size_id" integer NOT NULL,
	"bread_type_id" integer,
	"min_qty" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bread_size_tiers" ADD CONSTRAINT "bread_size_tiers_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bread_size_tiers" ADD CONSTRAINT "bread_size_tiers_bread_size_id_bread_sizes_id_fk" FOREIGN KEY ("bread_size_id") REFERENCES "public"."bread_sizes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bread_size_tiers" ADD CONSTRAINT "bread_size_tiers_bread_type_id_bread_types_id_fk" FOREIGN KEY ("bread_type_id") REFERENCES "public"."bread_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bread_size_tiers_uniq" ON "bread_size_tiers" USING btree ("bread_size_id","bread_type_id","min_qty");--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "deals_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "goods_snapshot" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pricing_breakdown" jsonb;
