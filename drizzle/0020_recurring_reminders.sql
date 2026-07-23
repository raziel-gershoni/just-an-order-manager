-- Automatic recurring-order reminders.
-- New reminder occasion for the twice-weekly auto-sends (distinct from the
-- manual week_start/shabbat blasts, so they log + rotate independently).
ALTER TYPE "public"."reminder_occasion" ADD VALUE 'recurring';--> statement-breakpoint
-- Master on/off for the feature (ships off — the route no-ops per group until on).
ALTER TABLE "groups" ADD COLUMN "recurring_reminders_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Per-phone gate for ALL automatic messages. Default true preserves today's
-- behaviour (every number is messaged) until the owner unchecks a number.
ALTER TABLE "customer_phones" ADD COLUMN "notify" boolean DEFAULT true NOT NULL;
