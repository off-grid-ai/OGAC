-- ============================================================================
-- Multi-tenancy RLS backstop (Phase 3) — REVIEW BEFORE APPLYING. NOT auto-run.
-- Generated from src/lib/rls-policy.ts (buildRlsMigrationSql). Apply steps in
-- deploy/onprem/SERVER_STATE.md § "Multi-tenancy (Phase 3 — RLS backstop)".
--
-- What this does:
--   1. Creates a NON-superuser role 'offgrid_app' (the app should connect as this, NOT the
--      superuser 'offgrid', so RLS is no longer bypassed).
--   2. Enables + FORCEs RLS on every tenant-scoped table and adds an 'org_isolation' policy.
--   3. The policy is a NO-OP while the session GUC 'app.current_org_id' is unset (backstop dormant,
--      app-level filtering governs) and ENFORCES org isolation once the GUC is set per request.
--
-- Everything is idempotent + guarded (skips a table that is absent or lacks org_id), so it is
-- safe to re-run and safe against code/server schema drift.
-- ============================================================================

-- 1) Non-superuser application role. LOGIN so the app can connect; NOBYPASSRLS is the whole point.
--    Set a real password out-of-band (ALTER ROLE offgrid_app WITH PASSWORD '...'); do NOT commit it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'offgrid_app') THEN
    CREATE ROLE offgrid_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE offgrid_app NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- 2) Baseline grants so the app role can use the schema + existing/future sequences and read the
--    NON-tenant tables (auth/session/config/etc. have no org_id and are shared infra). RLS only
--    gates the tenant tables below; everything else is plain table privileges.
GRANT USAGE ON SCHEMA public TO offgrid_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO offgrid_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO offgrid_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO offgrid_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO offgrid_app;

-- 3) Per-table RLS enable + org_isolation policy (tenant-scoped tables only).

-- api_keys
DO $$
BEGIN
  IF to_regclass('public.api_keys') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.api_keys';
    EXECUTE 'CREATE POLICY org_isolation ON public.api_keys FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_keys TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'api_keys';
  END IF;
END $$;

-- connectors
DO $$
BEGIN
  IF to_regclass('public.connectors') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'connectors' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.connectors FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.connectors';
    EXECUTE 'CREATE POLICY org_isolation ON public.connectors FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.connectors TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'connectors';
  END IF;
END $$;

-- masking_rules
DO $$
BEGIN
  IF to_regclass('public.masking_rules') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'masking_rules' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.masking_rules ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.masking_rules FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.masking_rules';
    EXECUTE 'CREATE POLICY org_isolation ON public.masking_rules FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.masking_rules TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'masking_rules';
  END IF;
END $$;

-- datasets
DO $$
BEGIN
  IF to_regclass('public.datasets') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'datasets' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.datasets FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.datasets';
    EXECUTE 'CREATE POLICY org_isolation ON public.datasets FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.datasets TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'datasets';
  END IF;
END $$;

-- governance_items
DO $$
BEGIN
  IF to_regclass('public.governance_items') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'governance_items' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.governance_items ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.governance_items FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.governance_items';
    EXECUTE 'CREATE POLICY org_isolation ON public.governance_items FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.governance_items TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'governance_items';
  END IF;
END $$;

-- agent_runs
DO $$
BEGIN
  IF to_regclass('public.agent_runs') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'agent_runs' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.agent_runs FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.agent_runs';
    EXECUTE 'CREATE POLICY org_isolation ON public.agent_runs FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_runs TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'agent_runs';
  END IF;
END $$;

-- routing_rules
DO $$
BEGIN
  IF to_regclass('public.routing_rules') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'routing_rules' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.routing_rules ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.routing_rules FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.routing_rules';
    EXECUTE 'CREATE POLICY org_isolation ON public.routing_rules FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.routing_rules TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'routing_rules';
  END IF;
END $$;

-- tools
DO $$
BEGIN
  IF to_regclass('public.tools') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tools' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.tools FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.tools';
    EXECUTE 'CREATE POLICY org_isolation ON public.tools FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.tools TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'tools';
  END IF;
END $$;

-- chat_artifacts
DO $$
BEGIN
  IF to_regclass('public.chat_artifacts') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'chat_artifacts' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.chat_artifacts ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.chat_artifacts FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.chat_artifacts';
    EXECUTE 'CREATE POLICY org_isolation ON public.chat_artifacts FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_artifacts TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'chat_artifacts';
  END IF;
END $$;

-- studio_templates
DO $$
BEGIN
  IF to_regclass('public.studio_templates') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'studio_templates' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.studio_templates ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.studio_templates FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.studio_templates';
    EXECUTE 'CREATE POLICY org_isolation ON public.studio_templates FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.studio_templates TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'studio_templates';
  END IF;
END $$;

-- provit_repos
DO $$
BEGIN
  IF to_regclass('public.provit_repos') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'provit_repos' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.provit_repos ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.provit_repos FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.provit_repos';
    EXECUTE 'CREATE POLICY org_isolation ON public.provit_repos FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.provit_repos TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'provit_repos';
  END IF;
END $$;

-- provit_runs
DO $$
BEGIN
  IF to_regclass('public.provit_runs') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'provit_runs' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.provit_runs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.provit_runs FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.provit_runs';
    EXECUTE 'CREATE POLICY org_isolation ON public.provit_runs FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.provit_runs TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'provit_runs';
  END IF;
END $$;

-- provit_tokens
DO $$
BEGIN
  IF to_regclass('public.provit_tokens') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'provit_tokens' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.provit_tokens ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.provit_tokens FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.provit_tokens';
    EXECUTE 'CREATE POLICY org_isolation ON public.provit_tokens FOR ALL TO offgrid_app ' ||
            'USING (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL) ' ||
            'WITH CHECK (org_id = current_setting(''app.current_org_id'', true) OR current_setting(''app.current_org_id'', true) IS NULL)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.provit_tokens TO offgrid_app';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', 'provit_tokens';
  END IF;
END $$;

-- ============================================================================
-- Verification (run as the app role AFTER switching DATABASE_URL):
--   SET app.current_org_id = 'org-a';
--   SELECT count(*) FROM connectors;              -- only org-a rows
--   RESET app.current_org_id;                     -- GUC unset → backstop dormant (app filtering governs)
-- As the superuser 'offgrid' you would still see everything (BYPASSRLS) — which is exactly why the
-- app must stop connecting as the superuser for the backstop to have any effect.
-- ============================================================================
