CREATE TABLE IF NOT EXISTS "memory_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL REFERENCES "accounts"("id"),
	"memory_id" uuid NOT NULL REFERENCES "memories"("id") ON DELETE CASCADE,
	"turn_id" uuid NOT NULL REFERENCES "turns"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memory_evidence_memory_turn_idx" ON "memory_evidence" USING btree ("memory_id","turn_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_evidence_account_idx" ON "memory_evidence" USING btree ("account_id","created_at");
