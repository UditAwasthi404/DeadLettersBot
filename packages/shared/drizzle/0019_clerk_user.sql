ALTER TABLE "accounts" ADD COLUMN "clerk_user_id" text;
CREATE UNIQUE INDEX "accounts_clerk_user_id_uq" ON "accounts" ("clerk_user_id");
