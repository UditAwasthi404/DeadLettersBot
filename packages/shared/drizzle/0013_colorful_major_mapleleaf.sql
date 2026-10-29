CREATE TABLE IF NOT EXISTS "memory_synthesis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL REFERENCES "accounts"("id"),
	"bot_id" uuid NOT NULL REFERENCES "bots"("id"),
	"turn_id" uuid NOT NULL REFERENCES "turns"("id"),
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"lease_token" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memory_synthesis_jobs_turn_idx" ON "memory_synthesis_jobs" USING btree ("turn_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_synthesis_jobs_due_idx" ON "memory_synthesis_jobs" USING btree ("status","next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_synthesis_jobs_account_idx" ON "memory_synthesis_jobs" USING btree ("account_id","created_at");
