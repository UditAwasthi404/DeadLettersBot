CREATE TABLE "subagents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "parent_bot_id" uuid NOT NULL REFERENCES "bots"("id"),
  "child_bot_id" uuid NOT NULL REFERENCES "bots"("id"),
  "parent_turn_id" uuid NOT NULL REFERENCES "turns"("id"),
  "child_turn_id" uuid NOT NULL REFERENCES "turns"("id"),
  "child_run_id" text NOT NULL,
  "completion_turn_id" uuid REFERENCES "turns"("id"),
  "completion_run_id" text,
  "task_description" text NOT NULL,
  "allowed_tools" jsonb NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "result" text DEFAULT '' NOT NULL,
  "usage" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone
);
CREATE INDEX "subagents_account_parent_idx" ON "subagents" USING btree ("account_id", "parent_bot_id");
CREATE INDEX "subagents_child_run_idx" ON "subagents" USING btree ("child_run_id");
