-- The 📦 delivered message the bot sends the owner and managers for every
-- delivery, one row per chat it went to, so its payment line and שולם button
-- can follow the order's payment (src/lib/order-buttons.ts). `content` is what
-- the copy shows now. Rows older than 30 days are dropped, and such a message
-- keeps what it shows (a tap is still checked against the order).
CREATE TABLE IF NOT EXISTS "tg_delivered_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "chat_id" varchar(50) NOT NULL,
  "message_id" integer NOT NULL,
  "order_id" integer NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "language" "language" NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tg_delivered_messages_order_idx" ON "tg_delivered_messages" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tg_delivered_messages_message_idx" ON "tg_delivered_messages" ("chat_id", "message_id");
