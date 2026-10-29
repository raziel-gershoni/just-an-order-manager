-- Orders read from a voice message or a text sent to the bot, waiting for the
-- owner to open them in the new-order form and save. Kept 7 days.
CREATE TABLE IF NOT EXISTS "order_drafts" (
  "id" varchar(21) PRIMARY KEY NOT NULL,
  "group_id" integer NOT NULL REFERENCES "groups"("id"),
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "source" varchar(10) NOT NULL,
  "tg_chat_id" bigint NOT NULL,
  "tg_message_id" integer NOT NULL,
  "reply_message_id" integer,
  "status" varchar(10) DEFAULT 'pending' NOT NULL,
  "transcript" text,
  "draft" jsonb,
  "order_id" integer REFERENCES "orders"("id"),
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_drafts_tg_message_uniq" ON "order_drafts" ("tg_chat_id", "tg_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_drafts_created_at_idx" ON "order_drafts" ("created_at");
