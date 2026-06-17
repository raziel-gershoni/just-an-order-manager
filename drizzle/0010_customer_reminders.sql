-- Custom SQL migration file, put your code below! --
CREATE TYPE "public"."reminder_occasion" AS ENUM('week_start', 'shabbat');--> statement-breakpoint
CREATE TYPE "public"."reminder_send_status" AS ENUM('sent', 'failed');--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "reminder_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "reminder_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"label" varchar(255) NOT NULL,
	"meta_template_name" varchar(255) NOT NULL,
	"occasion" "public"."reminder_occasion" NOT NULL,
	"body_preview" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_sends" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"phone_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"occasion" "public"."reminder_occasion" NOT NULL,
	"status" "public"."reminder_send_status" NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminder_templates" ADD CONSTRAINT "reminder_templates_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sends" ADD CONSTRAINT "reminder_sends_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sends" ADD CONSTRAINT "reminder_sends_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sends" ADD CONSTRAINT "reminder_sends_phone_id_customer_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."customer_phones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sends" ADD CONSTRAINT "reminder_sends_template_id_reminder_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."reminder_templates"("id") ON DELETE no action ON UPDATE no action;
