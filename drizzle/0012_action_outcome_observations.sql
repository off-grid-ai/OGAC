-- Outcome Observation Plane: atomic business facts correlated to canonical governed-action
-- receipts. This is intentionally independent of solution_deployments; an App action can be
-- observed before it is packaged as a reusable Solution. Forward-only and additive.

CREATE TABLE IF NOT EXISTS "action_outcome_observations" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "app_id" text NOT NULL,
  "run_id" text NOT NULL,
  "step_id" text NOT NULL,
  "receipt_idempotency_key" text NOT NULL,
  "action_id" text NOT NULL,
  "action_target" text NOT NULL,
  "action_executed_at" timestamp with time zone NOT NULL,
  "action_receipt" jsonb NOT NULL,
  "kind" text NOT NULL,
  "outcome_code" text,
  "observed_at" timestamp with time zone NOT NULL,
  "source_kind" text NOT NULL,
  "source_event_id" text NOT NULL,
  "source_idempotency_key" text NOT NULL,
  "note" text NOT NULL,
  "evidence_links" jsonb NOT NULL,
  "measurement" jsonb,
  "supersedes_id" text,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "action_outcome_observations_run_fk"
    FOREIGN KEY ("run_id") REFERENCES "app_runs"("id") ON DELETE RESTRICT,
  CONSTRAINT "action_outcome_observations_app_fk"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT,
  CONSTRAINT "action_outcome_observations_supersedes_fk"
    FOREIGN KEY ("supersedes_id") REFERENCES "action_outcome_observations"("id") ON DELETE RESTRICT,
  CONSTRAINT "action_outcome_observations_kind_check"
    CHECK ("kind" IN ('observed', 'corrected', 'withdrawn')),
  CONSTRAINT "action_outcome_observations_outcome_check"
    CHECK (("kind" = 'withdrawn' AND "outcome_code" IS NULL)
      OR ("kind" <> 'withdrawn' AND "outcome_code" IN ('accepted', 'rejected', 'converted', 'cured', 'settled'))),
  CONSTRAINT "action_outcome_observations_lifecycle_check"
    CHECK (("kind" = 'observed' AND "supersedes_id" IS NULL)
      OR ("kind" = 'corrected' AND "supersedes_id" IS NOT NULL)
      OR ("kind" = 'withdrawn' AND "supersedes_id" IS NOT NULL AND "measurement" IS NULL)),
  CONSTRAINT "action_outcome_observations_source_check"
    CHECK ("source_kind" IN ('human', 'system', 'import')),
  CONSTRAINT "action_outcome_observations_evidence_check"
    CHECK (jsonb_typeof("evidence_links") = 'array' AND jsonb_array_length("evidence_links") > 0),
  CONSTRAINT "action_outcome_observations_time_check"
    CHECK ("observed_at" >= "action_executed_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "action_outcome_observations_source_idempotency_idx"
  ON "action_outcome_observations" ("source_idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "action_outcome_observations_supersedes_idx"
  ON "action_outcome_observations" ("supersedes_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_outcome_observations_run_step_idx"
  ON "action_outcome_observations" ("org_id", "run_id", "step_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_outcome_observations_app_time_idx"
  ON "action_outcome_observations" ("org_id", "app_id", "observed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_outcome_observations_receipt_time_idx"
  ON "action_outcome_observations" ("org_id", "receipt_idempotency_key", "observed_at");
