-- T2 multi-tenant org-scoping: add org_id to the four tables that were GLOBAL (a cross-tenant
-- leak — every tenant saw the same agents/prompts/knowledge/eval history). The schema (src/db/schema.ts)
-- already declares these columns; this applies them on the live DB. Idempotent + safe to re-run.
--
-- Children (prompt_versions, org_knowledge_docs, org_knowledge_chunks) carry NO org_id of their own —
-- they inherit scope through their parent (prompt / collection), enforced in the store layer, so no
-- column is added here for them.
--
-- Seeded rows were created GLOBAL, so the 'default' backfill leaves them owned by the platform org,
-- which is correct (no per-tenant seed to re-tag). Apply with:
--   ssh ... "/usr/local/bin/docker exec -i offgrid-console-postgres-1 psql \"$DBURL\"" < 2026-t2-org-scoping.sql

ALTER TABLE custom_agents             ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE prompts                   ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE org_knowledge_collections ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE eval_runs                 ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';

-- Filter indexes: every list/rollup query is `WHERE org_id = $1`.
CREATE INDEX IF NOT EXISTS custom_agents_org_idx             ON custom_agents (org_id);
CREATE INDEX IF NOT EXISTS prompts_org_idx                   ON prompts (org_id);
CREATE INDEX IF NOT EXISTS org_knowledge_collections_org_idx ON org_knowledge_collections (org_id);
CREATE INDEX IF NOT EXISTS eval_runs_org_idx                 ON eval_runs (org_id);
