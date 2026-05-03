CREATE TABLE "bread_sizes" (
	"id" serial PRIMARY KEY NOT NULL,
	"bread_type_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"weight_grams" integer,
	"price" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "bread_size_id" integer;--> statement-breakpoint
ALTER TABLE "bread_sizes" ADD CONSTRAINT "bread_sizes_bread_type_id_bread_types_id_fk" FOREIGN KEY ("bread_type_id") REFERENCES "public"."bread_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_bread_size_id_bread_sizes_id_fk" FOREIGN KEY ("bread_size_id") REFERENCES "public"."bread_sizes"("id") ON DELETE no action ON UPDATE no action;