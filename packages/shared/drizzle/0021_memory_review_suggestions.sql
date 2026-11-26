CREATE TABLE "memory_review_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "bot_id" uuid NOT NULL REFERENCES "bots"("id"),
  "memory_id" uuid NOT NULL REFERENCES "memories"("id") ON DELETE CASCADE,
  "turn_id" uuid NOT NULL REFERENCES "turns"("id"),
  "proposed_content" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone
);
CREATE UNIQUE INDEX "memory_review_turn_memory_idx" ON "memory_review_suggestions" ("turn_id", "memory_id");
CREATE INDEX "memory_review_account_status_idx" ON "memory_review_suggestions" ("account_id", "status");
