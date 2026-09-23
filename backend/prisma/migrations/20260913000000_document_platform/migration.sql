-- This migration is intentionally additive and idempotent so an existing
-- FastAPI/Alembic development database can be upgraded without data loss.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "FileKind" AS ENUM ('FILE', 'DIRECTORY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BuildStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "users" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "firebase_uid" VARCHAR(128) NOT NULL,
  "email" VARCHAR(320),
  "email_verified" BOOLEAN NOT NULL DEFAULT false,
  "display_name" VARCHAR(128),
  "photo_url" VARCHAR(2048),
  "auth_provider" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_firebase_uid_key" ON "users"("firebase_uid");

CREATE TABLE IF NOT EXISTS "projects" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "workspace_status" VARCHAR(32) NOT NULL DEFAULT 'retired',
  "workspace_identifier" VARCHAR(255) NOT NULL DEFAULT gen_random_uuid()::text,
  "owner_id" UUID
);
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "root_file" VARCHAR(1024) NOT NULL DEFAULT 'main.tex';
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "latest_successful_build_id" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "projects_workspace_identifier_key" ON "projects"("workspace_identifier");
CREATE INDEX IF NOT EXISTS "projects_owner_id_idx" ON "projects"("owner_id");

DO $$ BEGIN
  ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "project_members" (
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "ProjectRole" NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("project_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "project_members_user_id_idx" ON "project_members"("user_id");

CREATE TABLE IF NOT EXISTS "file_entries" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "path" VARCHAR(1024) NOT NULL,
  "parent_path" VARCHAR(1024) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "kind" "FileKind" NOT NULL,
  "mime_type" VARCHAR(255),
  "current_version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS "file_entries_active_path_key" ON "file_entries"("project_id", "path") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "file_entries_project_parent_idx" ON "file_entries"("project_id", "parent_path");
CREATE INDEX IF NOT EXISTS "file_entries_project_path_idx" ON "file_entries"("project_id", "path");

CREATE TABLE IF NOT EXISTS "file_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "file_entry_id" UUID NOT NULL REFERENCES "file_entries"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL,
  "storage_key" VARCHAR(1536) NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "size" INTEGER NOT NULL,
  "created_by" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "file_versions_file_entry_version_key" UNIQUE ("file_entry_id", "version")
);
CREATE INDEX IF NOT EXISTS "file_versions_checksum_idx" ON "file_versions"("checksum");

CREATE TABLE IF NOT EXISTS "document_operations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "file_entry_id" UUID REFERENCES "file_entries"("id") ON DELETE SET NULL,
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "operation_type" VARCHAR(64) NOT NULL,
  "base_version" INTEGER,
  "result_version" INTEGER,
  "metadata" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "document_operations_project_created_idx" ON "document_operations"("project_id", "created_at");

CREATE TABLE IF NOT EXISTS "project_revisions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL,
  "root_file" VARCHAR(1024) NOT NULL,
  "manifest_storage_key" VARCHAR(1536) NOT NULL,
  "created_by" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "project_revisions_project_sequence_key" UNIQUE ("project_id", "sequence")
);
CREATE INDEX IF NOT EXISTS "project_revisions_project_created_idx" ON "project_revisions"("project_id", "created_at");

CREATE TABLE IF NOT EXISTS "revision_files" (
  "revision_id" UUID NOT NULL REFERENCES "project_revisions"("id") ON DELETE CASCADE,
  "file_entry_id" UUID NOT NULL REFERENCES "file_entries"("id") ON DELETE RESTRICT,
  "file_version_id" UUID NOT NULL REFERENCES "file_versions"("id") ON DELETE RESTRICT,
  "path" VARCHAR(1024) NOT NULL,
  "storage_key" VARCHAR(1536) NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "size" INTEGER NOT NULL,
  PRIMARY KEY ("revision_id", "file_entry_id")
);
CREATE INDEX IF NOT EXISTS "revision_files_file_version_idx" ON "revision_files"("file_version_id");

CREATE TABLE IF NOT EXISTS "builds" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "revision_id" UUID NOT NULL REFERENCES "project_revisions"("id") ON DELETE RESTRICT,
  "requested_by" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "root_file" VARCHAR(1024) NOT NULL,
  "status" "BuildStatus" NOT NULL DEFAULT 'QUEUED',
  "queue_job_id" VARCHAR(255),
  "compiler" VARCHAR(64) NOT NULL DEFAULT 'latexmk',
  "started_at" TIMESTAMPTZ,
  "finished_at" TIMESTAMPTZ,
  "exit_code" INTEGER,
  "duration_ms" INTEGER,
  "pdf_storage_key" VARCHAR(1536),
  "log_storage_key" VARCHAR(1536),
  "synctex_storage_key" VARCHAR(1536),
  "error_summary" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "builds_project_created_idx" ON "builds"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "builds_status_created_idx" ON "builds"("status", "created_at");
