-- Repair the migration BASELINE: 14 tables, 30 columns and 22 indexes/constraints that
-- src/db/schema.ts declares had NO migration creating them at all.
--
-- WHY they were invisible: `drizzle-kit generate` diffs schema.ts against its own meta/*_snapshot.json
-- — never against a database built from drizzle/*.sql. `npm run db:push` (drizzle-kit push) applies
-- schema.ts straight to a DB *and advances the snapshot*, so every table pushed that way was recorded
-- as "already migrated" while no SQL file ever created it. Generate therefore reported the schema as
-- clean. Live finding (2026-08-04): building an EMPTY database from `drizzle-kit migrate` and diffing
-- it against the snapshot is what exposed this — including `teams`, `team_members`, `pipelines`,
-- `pipeline_versions`, `publish_jobs`, `gateways`, `retention_policies`, `erasure_requests` and the
-- org_id tenancy columns on 15 tables, i.e. exactly the tables behind the tenant-scoping and RBAC
-- integration suites CI was skipping. `scripts/verify-migration-schema.mjs` now runs that diff as a
-- gate on every CI run so this class of drift cannot come back silently.
--
-- Mechanically generated (snapshot 0013 was first corrected to record what the migrations ACTUALLY
-- build, then `drizzle-kit generate` emitted this diff), then made idempotent (IF NOT EXISTS / a
-- DO-block guard on the UNIQUE constraint) — the fleet database already has all of it from db:push,
-- so this file must be a safe no-op there. Entirely ADDITIVE: no DROP, no type change.

CREATE TABLE IF NOT EXISTS "app_run_controls" (
	"app_id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"shadow_default" boolean DEFAULT false NOT NULL,
	"max_runs_per_day" integer,
	"spend_cap_usd" double precision,
	"spend_cap_scope" text DEFAULT 'day' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"name" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"connector_id" text,
	"domain_id" text,
	"kind" text DEFAULT 'table' NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"freshness_sla_hours" integer DEFAULT 0 NOT NULL,
	"last_refresh_at" timestamp with time zone,
	"sync_status" text DEFAULT 'unknown' NOT NULL,
	"sync_error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_classifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"asset_id" text NOT NULL,
	"column" text,
	"level" text DEFAULT 'internal' NOT NULL,
	"pii_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "erasure_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"erased_rows" integer DEFAULT 0 NOT NULL,
	"requested_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "export_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"kind" text NOT NULL,
	"endpoint" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"secret_ref" text,
	"last_status" text,
	"last_detail" text,
	"last_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gateways" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"default_model" text DEFAULT '' NOT NULL,
	"egress_class" text DEFAULT 'cloud' NOT NULL,
	"hostname" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"hashed_key" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipelines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"team_id" text,
	"gateway_id" text,
	"default_model" text,
	"routing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_overlay" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"guardrail_overlay" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_partials" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publish_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"status" text DEFAULT 'gating' NOT NULL,
	"override" boolean DEFAULT false NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"decision" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retention_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"asset_id" text NOT NULL,
	"retain_days" integer DEFAULT 0 NOT NULL,
	"action" text DEFAULT 'delete' NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_members" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"department" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abac_rules" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "pipeline_id" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_memory" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_projects" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_projects" ADD COLUMN IF NOT EXISTS "pipeline_id" text;--> statement-breakpoint
ALTER TABLE "chat_skills" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN IF NOT EXISTS "secret_ref" text;--> statement-breakpoint
ALTER TABLE "custom_agents" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_roles" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "token" text;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN IF NOT EXISTS "pipeline_id" text;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_nodes" ADD COLUMN IF NOT EXISTS "cluster_head" text;--> statement-breakpoint
ALTER TABLE "fleet_nodes" ADD COLUMN IF NOT EXISTS "rpc_port" integer;--> statement-breakpoint
ALTER TABLE "golden_cases" ADD COLUMN IF NOT EXISTS "app_id" text;--> statement-breakpoint
ALTER TABLE "golden_cases" ADD COLUMN IF NOT EXISTS "pipeline_id" text;--> statement-breakpoint
ALTER TABLE "golden_cases" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_knowledge_collections" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "default_chat_pipeline_id" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "chat_pipeline_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_library" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "slug" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_run_controls_org_idx" ON "app_run_controls" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_assets_org_idx" ON "data_assets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_assets_connector_idx" ON "data_assets" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_classifications_org_idx" ON "data_classifications" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_classifications_asset_idx" ON "data_classifications" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "erasure_requests_org_idx" ON "erasure_requests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "erasure_requests_subject_idx" ON "erasure_requests" USING btree ("subject");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_targets_org_idx" ON "export_targets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateways_org_idx" ON "gateways" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_api_keys_pipeline_idx" ON "pipeline_api_keys" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_api_keys_org_idx" ON "pipeline_api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_versions_pipeline_idx" ON "pipeline_versions" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipelines_org_idx" ON "pipelines" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipelines_gateway_idx" ON "pipelines" USING btree ("gateway_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipelines_team_idx" ON "pipelines" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publish_jobs_pipeline_idx" ON "publish_jobs" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_policies_org_idx" ON "retention_policies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_policies_asset_idx" ON "retention_policies" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_members_team_idx" ON "team_members" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_org_idx" ON "teams" USING btree ("org_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tenants" ADD CONSTRAINT "tenants_slug_unique" UNIQUE("slug");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;