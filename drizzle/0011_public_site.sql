-- Custom SQL migration file, put your code below! --
CREATE TABLE "media_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"blob_url" varchar(1000) NOT NULL,
	"blob_pathname" varchar(500) NOT NULL,
	"alt" varchar(255),
	"width" integer,
	"height" integer,
	"show_in_gallery" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bakery_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"slug" varchar(80),
	"is_published" boolean DEFAULT false NOT NULL,
	"display_name" varchar(255),
	"tagline" varchar(255),
	"hero_headline" varchar(255),
	"story" text,
	"trust_items" jsonb,
	"hero_image_id" integer,
	"logo_image_id" integer,
	"whatsapp_phone" varchar(32),
	"contact_phone" varchar(32),
	"instagram" varchar(64),
	"address" varchar(255),
	"map_url" varchar(1000),
	"bake_days" varchar(64),
	"pickup_area" varchar(120),
	"sections" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bakery_profile_group_id_unique" UNIQUE("group_id"),
	CONSTRAINT "bakery_profile_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "bread_types" ADD COLUMN "badge_type" varchar(20);--> statement-breakpoint
ALTER TABLE "bread_types" ADD COLUMN "badge_label" varchar(40);--> statement-breakpoint
ALTER TABLE "bread_types" ADD COLUMN "image_id" integer;--> statement-breakpoint
ALTER TABLE "bread_type_sizes" ADD COLUMN "badge_type" varchar(20);--> statement-breakpoint
ALTER TABLE "bread_type_sizes" ADD COLUMN "badge_label" varchar(40);--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bakery_profile" ADD CONSTRAINT "bakery_profile_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bakery_profile" ADD CONSTRAINT "bakery_profile_hero_image_id_media_assets_id_fk" FOREIGN KEY ("hero_image_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bakery_profile" ADD CONSTRAINT "bakery_profile_logo_image_id_media_assets_id_fk" FOREIGN KEY ("logo_image_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bread_types" ADD CONSTRAINT "bread_types_image_id_media_assets_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;
