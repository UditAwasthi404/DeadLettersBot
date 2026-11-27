ALTER TABLE "memory_review_suggestions" ADD COLUMN "action" text DEFAULT 'update' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_review_suggestions" ADD COLUMN "existing_content" text;--> statement-breakpoint
UPDATE "memory_review_suggestions" AS suggestion SET "existing_content" = memory.content FROM "memories" AS memory WHERE memory.id = suggestion.memory_id;--> statement-breakpoint
ALTER TABLE "memory_review_suggestions" ALTER COLUMN "existing_content" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_review_suggestions" ALTER COLUMN "proposed_content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_review_suggestions" ADD COLUMN "reason" text;