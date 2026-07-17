CREATE TABLE "solution_blueprints" (
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
CREATE INDEX "solution_blueprints_org_idx" ON "solution_blueprints" ("org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "solution_blueprints_catalog_key_idx" ON "solution_blueprints" ("org_id", "source_catalog_key");
--> statement-breakpoint
CREATE TABLE "solution_blueprint_versions" (
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
CREATE UNIQUE INDEX "solution_blueprint_versions_identity_idx" ON "solution_blueprint_versions" ("org_id", "blueprint_id", "version");
--> statement-breakpoint
CREATE TABLE "solution_blueprint_seed_state" (
  "org_id" text PRIMARY KEY NOT NULL,
  "catalog_version" integer DEFAULT 0 NOT NULL,
  "seeded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "solution_blueprint_seed_catalog_version_check" CHECK ("catalog_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "solution_deployments" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'default' NOT NULL,
  "blueprint_id" text NOT NULL,
  "blueprint_version" integer NOT NULL,
  "app_id" text NOT NULL,
  "pipeline_id" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "activated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retired_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "solution_deployments_status_check" CHECK ("status" IN ('active', 'paused', 'retired')),
  CONSTRAINT "solution_deployments_version_fk" FOREIGN KEY ("org_id", "blueprint_id", "blueprint_version") REFERENCES "solution_blueprint_versions"("org_id", "blueprint_id", "version") ON DELETE RESTRICT,
  CONSTRAINT "solution_deployments_app_fk" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT,
  CONSTRAINT "solution_deployments_pipeline_fk" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX "solution_deployments_org_idx" ON "solution_deployments" ("org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "solution_deployments_app_binding_idx" ON "solution_deployments" ("org_id", "app_id");
--> statement-breakpoint
CREATE TABLE "solution_observations" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'default' NOT NULL,
  "deployment_id" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "metric_value" double precision NOT NULL,
  "metric_label" text NOT NULL,
  "runs_completed" integer NOT NULL,
  "minutes_saved_per_run" double precision NOT NULL,
  "loaded_cost_per_hour" double precision NOT NULL,
  "actual_ai_cost" double precision NOT NULL,
  "evidence_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "solution_observations_window_check" CHECK ("window_end" > "window_start"),
  CONSTRAINT "solution_observations_runs_check" CHECK ("runs_completed" >= 0),
  CONSTRAINT "solution_observations_minutes_check" CHECK ("minutes_saved_per_run" >= 0),
  CONSTRAINT "solution_observations_loaded_cost_check" CHECK ("loaded_cost_per_hour" >= 0),
  CONSTRAINT "solution_observations_ai_cost_check" CHECK ("actual_ai_cost" >= 0),
  CONSTRAINT "solution_observations_deployment_fk" FOREIGN KEY ("deployment_id") REFERENCES "solution_deployments"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX "solution_observations_deployment_idx" ON "solution_observations" ("org_id", "deployment_id");
