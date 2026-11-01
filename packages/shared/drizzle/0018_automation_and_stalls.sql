ALTER TABLE "subagents" ADD COLUMN "stall_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "subagents" ADD COLUMN "last_progress_at" timestamptz;
ALTER TABLE "subagents" ADD COLUMN "stall_events" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "subagents" ADD COLUMN "steering_events" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "routines" ADD COLUMN "deleted_at" timestamptz;

CREATE TABLE "automation_shadows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "routine_id" uuid NOT NULL,
  "bot_id" uuid NOT NULL,
  "skill_id" uuid NOT NULL,
  "name" text NOT NULL,
  "trigger" jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "on_error" text DEFAULT 'pause' NOT NULL,
  "last_triggered_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "automation_shadows_routine_idx" ON "automation_shadows" ("routine_id");
CREATE INDEX "automation_shadows_account_idx" ON "automation_shadows" ("account_id");
