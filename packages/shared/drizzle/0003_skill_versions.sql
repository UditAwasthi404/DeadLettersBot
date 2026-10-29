CREATE TABLE "skill_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "skill_id" uuid NOT NULL REFERENCES "skills"("id"),
  "version" integer NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "steps" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "skill_versions_skill_idx" ON "skill_versions" USING btree ("skill_id", "version");
