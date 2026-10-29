CREATE TABLE "mcp_servers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "name" text NOT NULL,
  "url" text NOT NULL,
  "auth_token_ciphertext" text,
  "cached_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_health" text DEFAULT 'unknown' NOT NULL,
  "last_checked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "mcp_servers_account_idx" ON "mcp_servers" USING btree ("account_id");
