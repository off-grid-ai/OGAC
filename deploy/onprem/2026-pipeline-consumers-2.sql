-- ─── Pipeline consumers binding (CONSUMERS-BIND, task #166) ────────────────────────────────────────
-- The last structural piece of the 3-tier model: apps/agents/chat/projects BIND a pipeline.
--   • apps.pipeline_id            — the app/agent's bound governed pipeline (null ⇒ org default).
--   • chat_projects.pipeline_id   — per-project pipeline override (null ⇒ org-default chat pipeline).
--   • org_settings.default_chat_pipeline_id + chat_pipeline_allowlist — admin governance: the
--     org-default chat pipeline + the SET a user may pick from per-project (no ungoverned binding).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). Mirrors the ensure*Schema() self-migrate nets in the libs
-- (apps-store.ts, chat.ts, store.ts) so the code works even before this runs. Apply directly with the
-- pg client on the server (drizzle-kit push hangs over SSH — see deploy/DEPLOY.md § Database migrations).
--   docker exec -i offgrid-console-postgres-1 psql -U offgrid -d offgrid_console < 2026-pipeline-consumers-2.sql

ALTER TABLE apps          ADD COLUMN IF NOT EXISTS pipeline_id text;
ALTER TABLE chat_projects ADD COLUMN IF NOT EXISTS pipeline_id text;

ALTER TABLE org_settings  ADD COLUMN IF NOT EXISTS default_chat_pipeline_id text;
ALTER TABLE org_settings  ADD COLUMN IF NOT EXISTS chat_pipeline_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Consumer-by-pipeline lookups (Overview "Consumers" section + telemetry group-bys).
CREATE INDEX IF NOT EXISTS apps_pipeline_idx          ON apps (pipeline_id);
CREATE INDEX IF NOT EXISTS chat_projects_pipeline_idx ON chat_projects (pipeline_id);
