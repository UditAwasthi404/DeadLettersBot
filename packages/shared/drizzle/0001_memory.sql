CREATE TABLE "memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "bot_id" uuid REFERENCES "bots"("id"),
  "project_id" text,
  "scope" text NOT NULL,
  "content" text NOT NULL,
  "source" text NOT NULL,
  "source_turn_id" uuid REFERENCES "turns"("id"),
  "is_user_authored" boolean DEFAULT false NOT NULL,
  "stale_after" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "memories_account_scope_idx" ON "memories" USING btree ("account_id", "scope");
CREATE INDEX "memories_bot_idx" ON "memories" USING btree ("bot_id");
CREATE INDEX "memories_project_idx" ON "memories" USING btree ("project_id");
