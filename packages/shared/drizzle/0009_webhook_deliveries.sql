CREATE TABLE "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "subscription_id" uuid NOT NULL,
  "event" text NOT NULL,
  "url" text NOT NULL,
  "event_data" jsonb NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone,
  "lease_until" timestamp with time zone,
  "last_status_code" integer,
  "last_error" text,
  "response_snippet" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "delivered_at" timestamp with time zone
);
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("status", "next_attempt_at");
CREATE INDEX "webhook_deliveries_account_created_idx" ON "webhook_deliveries" USING btree ("account_id", "created_at");
CREATE INDEX "webhook_deliveries_subscription_idx" ON "webhook_deliveries" USING btree ("subscription_id");
