-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY EPIC — Wave 1 tenant isolation (#218) — DB migration
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds an org scope (org_id) to the shared control-plane / chat tables that were
-- previously GLOBAL, and rebuilds feature_flags' primary key from (key) to the
-- composite (org_id, key) so the same key coexists per tenant.
--
-- WHY: without org_id these surfaces leaked across tenants —
--   * devices        → kill/command/role reached ANY tenant's device by id (destructive IDOR, P0)
--   * audit_events   → /api/v1/audit returned EVERY tenant's trail (compliance-fatal leak, P0)
--   * user           → listUsers returned the whole directory (whole-directory leak, P0)
--   * abac_rules     → evaluateAbac read the global rule set (cross-tenant policy leak)
--   * routing_rules  → evaluateRouting considered every org's rules
--   * custom_roles   → listCustomRoles/getCustomRoleByName resolved other orgs' roles (RBAC leak)
--   * feature_flags  → a global (key) PK let one tenant's toggle flip a capability fleet-wide
--   * org_settings   → a single shared row (id='org') held one system prompt + chat binding for all
--   * prompt_library / prompt_partials / chat_skills / chat_memory → 'org'-visible rows leaked across tenants
--
-- This is the exact, idempotent SQL that src/lib/store.ts::ensureOrgSchema() applies
-- lazily on first use. It is reproduced here so it can be replayed on the servers with
-- the `pg` client / psql (drizzle-kit push hangs over SSH). Safe to run repeatedly.
--
-- Data is demo-only; every pre-hardening row is stamped org_id='default' by the column
-- default, and the legacy org_settings singleton (id='org') is re-homed onto 'default'.
--
-- Apply:  psql "$DATABASE_URL" -f deploy/onprem/migrations/wave1-tenant-isolation.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── org_settings: SINGLE shared row → one row PER TENANT (the id column IS the org id) ──
ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS default_chat_pipeline_id text;
ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS chat_pipeline_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE org_settings ALTER COLUMN id DROP DEFAULT;
-- Re-home the legacy 'org' singleton onto DEFAULT_ORG. Drop the stale 'org' row when a 'default'
-- one already exists (partially migrated DB) so the rename never collides on the PK; else rename it.
DELETE FROM org_settings WHERE id = 'org' AND EXISTS (SELECT 1 FROM org_settings WHERE id = 'default');
UPDATE org_settings SET id = 'default' WHERE id = 'org';

-- ── ingest_jobs: tenant scope on the ingest queue ──
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';

-- ── org_id on the shared tables (guarded: no-op when a lazily-created table isn't present yet) ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'devices', 'audit_events', 'abac_rules', 'routing_rules',
    'prompt_library', 'prompt_partials', 'chat_skills', 'chat_memory',
    'custom_roles', 'enrollment_tokens', 'user', 'feature_flags'
  ] LOOP
    IF to_regclass(format('%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT ''default'';', t);
    END IF;
  END LOOP;
END $$;

-- ── feature_flags: rebuild PK (key) → composite (org_id, key). Guarded so re-runs never error. ──
DO $$
BEGIN
  IF to_regclass('feature_flags') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'feature_flags'::regclass AND i.indisprimary AND a.attname = 'org_id'
  ) THEN
    ALTER TABLE feature_flags DROP CONSTRAINT IF EXISTS feature_flags_pkey;
    ALTER TABLE feature_flags ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (org_id, key);
  END IF;
END $$;

COMMIT;
