-- PA-12 (task #175): tag every eval run's telemetry with its pipeline at the SOURCE so per-pipeline
-- Drift (which reads the eval-run score history) becomes EXACT rather than best-effort. eval_runs was
-- org-scoped only; eval_definitions/golden_cases already carry pipeline_id, so this closes the loop by
-- stamping the RUN with the pipeline it executed in the context of.
--
-- src/db/schema.ts already declares eval_runs.pipeline_id and src/lib/evals.ts self-migrates it
-- (ALTER TABLE ... ADD COLUMN IF NOT EXISTS in ensureEvalsSchema) so the app never references a
-- missing column even before this runs. This file applies it on the live DB for the orchestrator.
-- Idempotent + safe to re-run. NULL = an org-wide/library run not bound to a pipeline (unchanged).
--
-- Apply with (mirrors 2026-t2-org-scoping.sql):
--   ssh ... "/usr/local/bin/docker exec -i offgrid-console-postgres-1 psql \"$DBURL\"" < 2026-eval-runs-pipeline.sql

ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS pipeline_id text;

-- Filter index: per-pipeline Drift reads `WHERE org_id = $1 AND pipeline_id = $2`.
CREATE INDEX IF NOT EXISTS eval_runs_pipeline_idx ON eval_runs (pipeline_id);
