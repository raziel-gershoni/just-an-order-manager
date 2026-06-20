-- Custom SQL migration file, put your code below! --
ALTER TABLE "groups" ADD COLUMN "logo_url" varchar(1000);--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "logo_pathname" varchar(500);
