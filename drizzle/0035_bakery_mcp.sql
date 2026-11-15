-- Bakery MCP (src/lib/mcp, src/lib/proposals): change_proposals stores every
-- change Claude proposes through the MCP server, and doubles as the change log
-- (what changed, when, who approved). Rows are never pruned. A bakery's MCP key
-- is kept only as its SHA-256 hash on groups.
DO $$ BEGIN
  CREATE TYPE "change_proposal_kind" AS ENUM('recipe', 'size_price', 'bread_price', 'deal', 'ingredient_price');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "change_proposal_status" AS ENUM('pending', 'applying', 'applied', 'rejected', 'expired', 'stale', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_proposals" (
  "id" serial PRIMARY KEY NOT NULL,
  "group_id" integer NOT NULL REFERENCES "groups"("id"),
  "kind" "change_proposal_kind" NOT NULL,
  "target" jsonb NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "summary_he" text NOT NULL,
  "status" "change_proposal_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "decided_by_user_id" integer REFERENCES "users"("id"),
  "decided_at" timestamp with time zone,
  "error" text
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_proposals_group_status_idx" ON "change_proposals" ("group_id", "status");--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "mcp_key_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "mcp_key_created_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "groups_mcp_key_hash_idx" ON "groups" ("mcp_key_hash");
