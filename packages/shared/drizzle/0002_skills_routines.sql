CREATE TABLE "skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "owner_bot_id" uuid REFERENCES "bots"("id"),
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "skills_account_id_idx" ON "skills" USING btree ("account_id");
CREATE TABLE "routines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "bot_id" uuid NOT NULL REFERENCES "bots"("id"),
  "skill_id" uuid NOT NULL REFERENCES "skills"("id"),
  "name" text NOT NULL,
  "trigger" jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "on_error" text DEFAULT 'pause' NOT NULL,
  "last_triggered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "routines_account_id_idx" ON "routines" USING btree ("account_id");
CREATE INDEX "routines_enabled_idx" ON "routines" USING btree ("enabled");
CREATE TABLE "routine_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "routine_id" uuid NOT NULL REFERENCES "routines"("id"),
  "triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "duration_ms" integer,
  "input_summary" text DEFAULT '' NOT NULL,
  "output_summary" text DEFAULT '' NOT NULL,
  "error_message" text
);
CREATE INDEX "routine_runs_routine_time_idx" ON "routine_runs" USING btree ("routine_id", "triggered_at");
