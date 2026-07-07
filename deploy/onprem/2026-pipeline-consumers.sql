-- Pipeline consumers + provisioning schema (fan-out round).
-- Applied to the live console DB via: docker exec -i offgrid-console-postgres-1 psql -U offgrid -d offgrid_console
-- Idempotent — safe to re-run.

-- (B) golden_cases: governance owner is the PIPELINE (3-tier). app_id kept for back-compat.
ALTER TABLE golden_cases ADD COLUMN IF NOT EXISTS pipeline_id text;
CREATE INDEX IF NOT EXISTS golden_cases_pipeline_idx ON golden_cases (pipeline_id);

-- (B) eval_definitions is created by lib/eval-defs.ts ensure-schema (not a drizzle table);
-- its pipeline_id column is added there. Mirrored here for the explicit-migration path:
ALTER TABLE eval_definitions ADD COLUMN IF NOT EXISTS pipeline_id text;

-- (C) per-pipeline provisioned API keys — the pipeline as its own callable governed endpoint.
CREATE TABLE IF NOT EXISTS pipeline_api_keys (
  id          text PRIMARY KEY,
  pipeline_id text NOT NULL,
  org_id      text NOT NULL DEFAULT 'default',
  name        text NOT NULL DEFAULT '',
  hashed_key  text NOT NULL,
  prefix      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL DEFAULT '',
  revoked_at  timestamptz
);
CREATE INDEX IF NOT EXISTS pipeline_api_keys_pipeline_idx ON pipeline_api_keys (pipeline_id);
CREATE INDEX IF NOT EXISTS pipeline_api_keys_org_idx ON pipeline_api_keys (org_id);
