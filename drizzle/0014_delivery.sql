-- Custom SQL migration file, put your code below! --
ALTER TABLE "groups" ADD COLUMN "delivery_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "delivery_home_city" varchar(255);--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "delivery_fee" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "delivery_free_over" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "delivery_cities" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "is_delivery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_fee" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "delivery_notes" text;
