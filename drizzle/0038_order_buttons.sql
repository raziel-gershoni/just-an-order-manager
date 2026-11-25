-- The order buttons the bot has sent (אשר, נמסר, שולם), one row per button on
-- each message, so a status change or a payment made anywhere can take the
-- buttons that no longer apply off every copy (src/lib/order-buttons.ts). A row
-- is deleted once its button is gone; rows older than 30 days are dropped, and
-- such a message keeps what it shows (a tap is still checked against the order).
CREATE TABLE IF NOT EXISTS "tg_order_buttons" (
  "id" serial PRIMARY KEY NOT NULL,
  "chat_id" varchar(50) NOT NULL,
  "message_id" integer NOT NULL,
  "position" integer NOT NULL,
  "order_id" integer NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "action" varchar(16) NOT NULL,
  "label" text NOT NULL,
  "callback_data" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tg_order_buttons_order_idx" ON "tg_order_buttons" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tg_order_buttons_message_idx" ON "tg_order_buttons" ("chat_id", "message_id");
