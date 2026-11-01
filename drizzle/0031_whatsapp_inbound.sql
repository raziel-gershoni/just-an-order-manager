-- WhatsApp messages forwarded to Telegram, by Meta's message id (wamid).
-- Meta re-sends a webhook until it gets a 200, so the id is claimed before the
-- forward and a repeat delivery finds it taken. forwarded_at stays NULL while
-- the forward is in flight (or died) and is set once it is done: a repeat
-- delivery skips a finished message, waits for a recent unfinished one, and
-- takes over an old one. Rows are never read back otherwise.
CREATE TABLE IF NOT EXISTS "whatsapp_inbound" (
  "message_id" varchar(128) PRIMARY KEY NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "forwarded_at" timestamp with time zone
);
