-- Per-number "is on WhatsApp". Additive with a default, so every existing
-- number keeps behaving exactly as before until the owner marks one.
ALTER TABLE "customer_phones" ADD COLUMN IF NOT EXISTS "has_whatsapp" boolean DEFAULT true NOT NULL;
