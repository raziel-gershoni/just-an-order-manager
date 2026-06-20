-- Custom SQL migration file, put your code below! --
ALTER TABLE "bread_types" ADD COLUMN "badge_icon" varchar(20);--> statement-breakpoint
ALTER TABLE "bread_type_sizes" ADD COLUMN "badge_icon" varchar(20);
