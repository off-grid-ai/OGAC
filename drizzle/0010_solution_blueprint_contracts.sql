-- Upgrade safety for the rejected request-time-DDL schema. Preserve those tables as read-only
-- legacy archives before creating the versioned contract model. PostgreSQL DDL is transactional,
-- so a failed migration restores the original names and indexes automatically.
DO $$
BEGIN
  IF to_regclass(current_schema() || '.solution_blueprints') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'solution_blueprints'
         AND column_name = 'current_version'
     ) THEN
    ALTER TABLE solution_blueprints RENAME TO solution_blueprints_legacy;
    ALTER INDEX IF EXISTS solution_blueprints_org_idx RENAME TO solution_blueprints_legacy_org_idx;
  END IF;

  IF to_regclass(current_schema() || '.solution_deployments') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'solution_deployments'
         AND column_name = 'blueprint_version'
     ) THEN
    ALTER TABLE solution_deployments RENAME TO solution_deployments_legacy;
    ALTER INDEX IF EXISTS solution_deployments_org_idx RENAME TO solution_deployments_legacy_org_idx;
    ALTER INDEX IF EXISTS solution_deployments_binding_idx RENAME TO solution_deployments_legacy_binding_idx;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "solution_blueprints" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'default' NOT NULL,
  "current_version" integer DEFAULT 1 NOT NULL,
  "source_catalog_key" text,
  "catalog_version" integer,
  "tombstoned_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "solution_blueprints_current_version_check" CHECK ("current_version" > 0),
  CONSTRAINT "solution_blueprints_catalog_version_check" CHECK ("catalog_version" IS NULL OR "catalog_version" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "solution_blueprints_org_idx" ON "solution_blueprints" ("org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "solution_blueprints_catalog_key_idx" ON "solution_blueprints" ("org_id", "source_catalog_key");
--> statement-breakpoint
-- The rejected request-time schema already created this table with only (org_id, seeded_at).
-- Existing rows mean catalog v1 was installed, so backfill them to v1; the normal store seeder then
-- appends the honest v2 snapshots. Fresh installs still start at v0 below.
DO $$
BEGIN
  IF to_regclass(current_schema() || '.solution_blueprint_seed_state') IS NOT NULL THEN
    ALTER TABLE solution_blueprint_seed_state
      ADD COLUMN IF NOT EXISTS catalog_version integer NOT NULL DEFAULT 1;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass(current_schema() || '.solution_blueprint_seed_state')
        AND conname = 'solution_blueprint_seed_catalog_version_check'
    ) THEN
      ALTER TABLE solution_blueprint_seed_state
        ADD CONSTRAINT solution_blueprint_seed_catalog_version_check
        CHECK (catalog_version >= 0);
    END IF;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "solution_blueprint_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "blueprint_id" text NOT NULL,
  "org_id" text DEFAULT 'default' NOT NULL,
  "version" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "solution_blueprint_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "solution_blueprint_versions_blueprint_fk" FOREIGN KEY ("blueprint_id") REFERENCES "solution_blueprints"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "solution_blueprint_versions_identity_idx" ON "solution_blueprint_versions" ("org_id", "blueprint_id", "version");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "solution_blueprint_seed_state" (
  "org_id" text PRIMARY KEY NOT NULL,
  "catalog_version" integer DEFAULT 0 NOT NULL,
  "seeded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "solution_blueprint_seed_catalog_version_check" CHECK ("catalog_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "solution_deployments" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'default' NOT NULL,
  "blueprint_id" text NOT NULL,
  "blueprint_version" integer NOT NULL,
  "app_id" text NOT NULL,
  "pipeline_id" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "activated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "paused_at" timestamp with time zone,
  "retired_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "solution_deployments_status_check" CHECK ("status" IN ('active', 'paused', 'retired')),
  CONSTRAINT "solution_deployments_version_fk" FOREIGN KEY ("org_id", "blueprint_id", "blueprint_version") REFERENCES "solution_blueprint_versions"("org_id", "blueprint_id", "version") ON DELETE RESTRICT,
  CONSTRAINT "solution_deployments_app_fk" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
-- CREATE TABLE IF NOT EXISTS does not reconcile a table created by an earlier version of this
-- migration. paused_at was added with the pause lifecycle, so explicitly upgrade those databases.
ALTER TABLE "solution_deployments"
  ADD COLUMN IF NOT EXISTS "paused_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "solution_deployments_org_idx" ON "solution_deployments" ("org_id");
--> statement-breakpoint
-- Only a live binding is unique. Retired rows remain immutable audit history and do not prevent the
-- same App from adopting a newer Blueprint version or a different Blueprint later.
CREATE UNIQUE INDEX IF NOT EXISTS "solution_deployments_live_app_binding_idx"
  ON "solution_deployments" ("org_id", "app_id") WHERE "status" <> 'retired';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "solution_observations" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'default' NOT NULL,
  "deployment_id" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "claimed_metric_value" double precision NOT NULL,
  "claim_label" text NOT NULL,
  "run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "runs_completed" integer NOT NULL,
  "estimated_minutes_saved_per_run" double precision NOT NULL,
  "estimated_loaded_cost_per_hour" double precision NOT NULL,
  "actual_ai_cost" double precision NOT NULL,
  "evidence_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "solution_observations_window_check" CHECK ("window_end" > "window_start"),
  CONSTRAINT "solution_observations_runs_check" CHECK ("runs_completed" >= 0),
  CONSTRAINT "solution_observations_minutes_check" CHECK ("estimated_minutes_saved_per_run" >= 0),
  CONSTRAINT "solution_observations_loaded_cost_check" CHECK ("estimated_loaded_cost_per_hour" >= 0),
  CONSTRAINT "solution_observations_ai_cost_check" CHECK ("actual_ai_cost" >= 0),
  CONSTRAINT "solution_observations_evidence_check" CHECK (jsonb_array_length("evidence_links") > 0),
  CONSTRAINT "solution_observations_run_ids_check" CHECK (jsonb_typeof("run_ids") = 'array'),
  CONSTRAINT "solution_observations_deployment_fk" FOREIGN KEY ("deployment_id") REFERENCES "solution_deployments"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "solution_observations_deployment_idx" ON "solution_observations" ("org_id", "deployment_id");
--> statement-breakpoint
-- Convert legacy definitions to non-adoptable versioned hypotheses. No legacy proof or measured
-- value is promoted to verified truth. The original legacy tables remain available for audit and
-- rollback inspection. Legacy deployment rows are preserved as retired history because their old
-- schema did not pin a trustworthy pipeline contract.
DO $$
BEGIN
  IF to_regclass(current_schema() || '.solution_blueprints_legacy') IS NOT NULL THEN
    EXECUTE $migrate$
      INSERT INTO solution_blueprints
        (id, org_id, current_version, source_catalog_key, catalog_version, created_at, updated_at)
      SELECT
        id,
        org_id,
        1,
        CASE
          WHEN title = 'Delinquency Intervention' AND source_template_key = 'loan-underwriting'
            THEN 'lending-delinquency-intervention'
          WHEN title = 'Indemnity Claim Fast Track' AND source_template_key = 'claims-triage'
            THEN 'insurance-indemnity-fast-track'
          ELSE NULL
        END,
        CASE
          WHEN (title = 'Delinquency Intervention' AND source_template_key = 'loan-underwriting')
            OR (title = 'Indemnity Claim Fast Track' AND source_template_key = 'claims-triage')
            THEN 1
          ELSE NULL
        END,
        created_at,
        updated_at
      FROM solution_blueprints_legacy
      ON CONFLICT (id) DO NOTHING
    $migrate$;

    EXECUTE $migrate$
      INSERT INTO solution_blueprint_versions
        (id, blueprint_id, org_id, version, snapshot, created_by, created_at)
      SELECT
        'sbv_' || substr(md5(id || ':' || org_id), 1, 12),
        id,
        org_id,
        1,
        jsonb_build_object(
          'title', title,
          'summary', summary,
          'industry', industry,
          'process', process,
          'businessOwner', business_owner,
          'requiredDataDomains', required_data_domains,
          'requiredCapabilities', jsonb_build_array('grounded-inference'),
          'requiredPipelineName', governed_pipeline,
          'sourceTemplateKey', source_template_key,
          'adoptable', false,
          'outcome', jsonb_set(outcome, '{measured}', 'null'::jsonb, true),
          'proof', jsonb_build_object(
            'status', 'unverified',
            'summary', 'Migrated legacy definition. Verify evidence before adoption.',
            'evidenceLinks', jsonb_build_array()
          )
        ),
        'migration:0010',
        created_at
      FROM solution_blueprints_legacy
      ON CONFLICT (org_id, blueprint_id, version) DO NOTHING
    $migrate$;
  END IF;

  IF to_regclass(current_schema() || '.solution_deployments_legacy') IS NOT NULL
     AND to_regclass(current_schema() || '.solution_blueprints_legacy') IS NOT NULL THEN
    EXECUTE $migrate$
      INSERT INTO solution_deployments
        (id, org_id, blueprint_id, blueprint_version, app_id, pipeline_id, status,
         activated_at, paused_at, retired_at, created_at, updated_at)
      SELECT
        legacy.id,
        legacy.org_id,
        legacy.blueprint_id,
        1,
        legacy.app_id,
        'legacy:unverified',
        'retired',
        legacy.created_at,
        NULL,
        COALESCE(legacy.updated_at, legacy.created_at),
        legacy.created_at,
        legacy.updated_at
      FROM solution_deployments_legacy legacy
      JOIN apps ON apps.id = legacy.app_id AND apps.org_id = legacy.org_id
      JOIN solution_blueprints blueprint
        ON blueprint.id = legacy.blueprint_id AND blueprint.org_id = legacy.org_id
      ON CONFLICT (id) DO NOTHING
    $migrate$;
  END IF;
END $$;
