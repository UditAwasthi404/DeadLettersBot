CREATE TABLE "automation_shadows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"on_error" text DEFAULT 'pause' NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_review_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"memory_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"action" text DEFAULT 'update' NOT NULL,
	"existing_content" text NOT NULL,
	"proposed_content" text,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "clerk_user_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_active_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "local_machine_access" text DEFAULT 'always_confirm' NOT NULL;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "retain_data" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subagents" ADD COLUMN "stall_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subagents" ADD COLUMN "last_progress_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subagents" ADD COLUMN "stall_events" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subagents" ADD COLUMN "steering_events" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_shadows" ADD CONSTRAINT "automation_shadows_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_review_suggestions" ADD CONSTRAINT "memory_review_suggestions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_review_suggestions" ADD CONSTRAINT "memory_review_suggestions_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_review_suggestions" ADD CONSTRAINT "memory_review_suggestions_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_review_suggestions" ADD CONSTRAINT "memory_review_suggestions_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_shadows_routine_idx" ON "automation_shadows" USING btree ("routine_id");--> statement-breakpoint
CREATE INDEX "automation_shadows_account_idx" ON "automation_shadows" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_review_turn_memory_idx" ON "memory_review_suggestions" USING btree ("turn_id","memory_id");--> statement-breakpoint
CREATE INDEX "memory_review_account_status_idx" ON "memory_review_suggestions" USING btree ("account_id","status");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_clerk_user_id_unique" UNIQUE("clerk_user_id");