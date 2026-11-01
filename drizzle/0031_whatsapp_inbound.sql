-- WhatsApp messages already forwarded to Telegram, by Meta's message id (wamid).
-- Meta re-sends a webhook until it gets a 200, so the id is claimed before the
-- forward and a repeat delivery finds it taken. Rows are never read back.
CREATE TABLE IF NOT EXISTS "whatsapp_inbound" (
  "message_id" varchar(128) PRIMARY KEY NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
