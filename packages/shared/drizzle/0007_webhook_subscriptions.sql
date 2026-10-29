CREATE TABLE "webhook_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "url" text NOT NULL,
  "secret_ciphertext" text NOT NULL,
  "events" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "webhook_subscriptions_account_idx" ON "webhook_subscriptions" USING btree ("account_id");
