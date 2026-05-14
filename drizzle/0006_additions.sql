-- Bread additions (toppings): global per-group catalog, per-type opt-in, per-line-item picks.
-- Pure additive migration; no existing tables touched.

CREATE TABLE "bread_additions" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "bread_type_additions" (
	"bread_type_id" integer NOT NULL,
	"bread_addition_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bread_type_additions_bread_type_id_bread_addition_id_pk" PRIMARY KEY("bread_type_id","bread_addition_id")
);--> statement-breakpoint

CREATE TABLE "order_item_additions" (
	"order_item_id" integer NOT NULL,
	"bread_addition_id" integer NOT NULL,
	CONSTRAINT "order_item_additions_order_item_id_bread_addition_id_pk" PRIMARY KEY("order_item_id","bread_addition_id")
);--> statement-breakpoint

ALTER TABLE "bread_additions" ADD CONSTRAINT "bread_additions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bread_type_additions" ADD CONSTRAINT "bread_type_additions_bread_type_id_bread_types_id_fk" FOREIGN KEY ("bread_type_id") REFERENCES "public"."bread_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bread_type_additions" ADD CONSTRAINT "bread_type_additions_bread_addition_id_bread_additions_id_fk" FOREIGN KEY ("bread_addition_id") REFERENCES "public"."bread_additions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_additions" ADD CONSTRAINT "order_item_additions_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_additions" ADD CONSTRAINT "order_item_additions_bread_addition_id_bread_additions_id_fk" FOREIGN KEY ("bread_addition_id") REFERENCES "public"."bread_additions"("id") ON DELETE no action ON UPDATE no action;
