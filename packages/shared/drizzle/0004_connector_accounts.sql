CREATE TABLE "connector_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "service" text NOT NULL,
  "provider_user_id" text,
  "access_token_ciphertext" text NOT NULL,
  "refresh_token_ciphertext" text,
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "connector_accounts_account_service_uq" ON "connector_accounts" USING btree ("account_id", "service");
CREATE INDEX "connector_accounts_account_idx" ON "connector_accounts" USING btree ("account_id");
