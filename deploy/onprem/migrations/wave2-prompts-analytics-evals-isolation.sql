-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY EPIC — Wave 2 tenant isolation (#218) — DB migration
-- Surfaces: PROMPTS (library) · EVALS + GOLDEN · ANALYTICS RULES/VIEWS
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds / re-asserts an org scope (org_id) on the entities these surfaces own and
-- indexes it. WHY: before Wave 2 the list/get/update/delete queries on each of
-- these carried NO org_id filter, so every tenant could READ, EDIT, and DELETE
-- every other tenant's rows (cross-tenant read + write leak):
--
--   * prompt_library       → an 'org'-visibility prompt leaked to EVERY tenant, and
--                            any tenant could read/edit/delete another's prompt by id.
--                            (org_id column itself was already added in Wave 1;
--                             Wave 2 fixes the QUERIES that ignored it + adds an index.)
--   * golden_cases         → list/get/update/delete ignored org_id (column existed from an
--                            earlier migration); a tenant saw + mutated another's golden set.
--   * eval_definitions     → had NO org_id at all; every saved evaluator was global —
--                            listed, editable, deletable, and RUNNABLE by any tenant.
--   * analytics_alert_rules→ had NO org_id; every alert rule was visible/editable/deletable
--   * analytics_saved_views→ had NO org_id; every saved view was visible/editable/deletable
--                            across all tenants.
--
-- This is the exact, idempotent SQL the app's ensure* functions apply lazily on first
-- use (src/lib/prompts.ts::ensurePromptSchema, src/lib/evals.ts::ensureEvalsSchema,
-- src/lib/eval-defs.ts::ensureEvalDefsSchema, src/lib/analytics-rules.ts::
-- ensureAnalyticsRulesSchema). Reproduced here to replay on the servers with the `pg`
-- client / psql (drizzle-kit push hangs over SSH). Safe to run repeatedly.
--
-- Every pre-hardening row is stamped org_id='default' by the column default.
--
-- Apply:  psql "$DATABASE_URL" -f deploy/onprem/migrations/wave2-prompts-analytics-evals-isolation.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- PROMPTS — org_id was added in Wave 1; re-assert (idempotent) + add the org index the
-- scoped list query uses. Guarded on existence (the app self-creates this table on first use).
DO $$
BEGIN
  IF to_regclass('prompt_library') IS NOT NULL THEN
    ALTER TABLE prompt_library ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
    CREATE INDEX IF NOT EXISTS prompt_library_org_idx ON prompt_library (org_id, updated_at);
  END IF;
END $$;

-- GOLDEN CASES — org_id column pre-existed; re-assert + index (used by the scoped list/get). Guarded.
DO $$
BEGIN
  IF to_regclass('golden_cases') IS NOT NULL THEN
    ALTER TABLE golden_cases ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
    CREATE INDEX IF NOT EXISTS golden_cases_org_idx ON golden_cases (org_id);
  END IF;
END $$;

-- EVAL DEFINITIONS — NEW org scope (had none). Table is self-created by the app; guard on
-- existence so this replays cleanly whether or not the app has cold-started yet.
DO $$
BEGIN
  IF to_regclass('eval_definitions') IS NOT NULL THEN
    ALTER TABLE eval_definitions ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
    CREATE INDEX IF NOT EXISTS eval_definitions_org_idx ON eval_definitions (org_id);
  END IF;
END $$;

-- ANALYTICS ALERT RULES — NEW org scope (had none). Self-created by the app; guarded.
DO $$
BEGIN
  IF to_regclass('analytics_alert_rules') IS NOT NULL THEN
    ALTER TABLE analytics_alert_rules ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
    CREATE INDEX IF NOT EXISTS analytics_alert_rules_org_idx ON analytics_alert_rules (org_id);
  END IF;
END $$;

-- ANALYTICS SAVED VIEWS — NEW org scope (had none). Self-created by the app; guarded.
DO $$
BEGIN
  IF to_regclass('analytics_saved_views') IS NOT NULL THEN
    ALTER TABLE analytics_saved_views ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
    CREATE INDEX IF NOT EXISTS analytics_saved_views_org_idx ON analytics_saved_views (org_id);
  END IF;
END $$;

COMMIT;
