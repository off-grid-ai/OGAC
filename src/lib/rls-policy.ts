// PURE row-level-security policy model — ZERO imports, fully unit-testable.
//
// The app connects to Postgres as the SUPERUSER `offgrid`, which BYPASSES RLS entirely. Org
// isolation today is enforced in the query layer (org_id = $current filters). This module is the
// single source of truth for the DB-enforced BACKSTOP behind that: a non-superuser app role plus
// per-table RLS policies on the tenant-scoped tables (the ones carrying `org_id`).
//
// Design constraint (why this is safe to ship as a backstop and not a behaviour change):
//   The app does NOT currently set a Postgres session GUC. So the policy is written to be a NO-OP
//   when `app.current_org_id` is unset (current_setting(..., true) → NULL) — the app's existing
//   query-layer filtering still governs — and to ENFORCE isolation the moment the GUC IS set. That
//   means switching the app to the non-superuser role does not change results on day one; it only
//   removes the superuser bypass so the policy CAN take effect. Setting the GUC per request (via the
//   documented `withOrg` wrapper) then turns the backstop live without touching any route's logic.
//
// The generated SQL is idempotent and defensive: every statement guards on the table actually
// existing AND having an `org_id` column, so a schema drift between code and the live server (tables
// were created directly on S1 — see SERVER_STATE.md) can never make the migration fail hard.

// The tenant-scoped tables (SQL names) that carry `org_id`. Kept here as the SSOT so a test can
// assert it matches the schema, and the .sql artifact is generated from exactly this list.
export const TENANT_SCOPED_TABLES: readonly string[] = [
  'api_keys',
  'connectors',
  'masking_rules',
  'datasets',
  'governance_items',
  'agent_runs',
  'routing_rules',
  'tools',
  'chat_artifacts',
  'studio_templates',
  'provit_repos',
  'provit_runs',
  'provit_tokens',
];

// The Postgres session variable the RLS policy reads. `current_setting(GUC, true)` returns NULL when
// unset (the `true` = missing_ok) rather than erroring — that's what makes the policy a no-op until
// the app opts in by setting it.
export const ORG_GUC = 'app.current_org_id';

// The non-superuser role the app should connect as so RLS is NOT bypassed.
export const APP_ROLE = 'offgrid_app';

// A valid, unqualified SQL identifier (defensive guard for the generator — the list above is fixed,
// but this keeps the function honest if ever fed dynamic input).
export function isSafeIdentifier(name: unknown): name is string {
  return typeof name === 'string' && /^[a-z_][a-z0-9_]*$/.test(name) && name.length <= 63;
}

// The USING/CHECK predicate for the org-isolation policy on one table. Permissive when the GUC is
// unset (backstop dormant → app-level filtering governs); strict equality when it IS set.
export function orgIsolationPredicate(): string {
  return `org_id = current_setting('${ORG_GUC}', true) OR current_setting('${ORG_GUC}', true) IS NULL`;
}

// Generate the RLS enable + policy block for a single table. Guarded on the table existing AND
// having an org_id column (via a DO block + to_regcol check), so it's safe against schema drift.
export function tablePolicySql(table: string): string {
  if (!isSafeIdentifier(table)) {
    throw new Error(`unsafe table identifier: ${String(table)}`);
  }
  const predicate = orgIsolationPredicate();
  const policyName = `org_isolation`;
  return `-- ${table}
DO $$
BEGIN
  IF to_regclass('public.${table}') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = 'org_id'
     )
  THEN
    EXECUTE 'ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS ${policyName} ON public.${table}';
    EXECUTE 'CREATE POLICY ${policyName} ON public.${table} FOR ALL TO ${APP_ROLE} ' ||
            'USING (${predicate.replaceAll("'", "''")}) ' ||
            'WITH CHECK (${predicate.replaceAll("'", "''")})';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO ${APP_ROLE}';
  ELSE
    RAISE NOTICE 'skip %: absent or has no org_id column', '${table}';
  END IF;
END $$;`;
}

// Build the complete migration SQL: role creation (idempotent), schema/sequence grants, and the
// per-table policy blocks. Pure string assembly so a test can assert its shape without a DB.
export function buildRlsMigrationSql(
  tables: readonly string[] = TENANT_SCOPED_TABLES,
): string {
  for (const t of tables) {
    if (!isSafeIdentifier(t)) throw new Error(`unsafe table identifier: ${String(t)}`);
  }
  const header = `-- ============================================================================
-- Multi-tenancy RLS backstop (Phase 3) — REVIEW BEFORE APPLYING. NOT auto-run.
-- Generated from src/lib/rls-policy.ts (buildRlsMigrationSql). Apply steps in
-- deploy/onprem/SERVER_STATE.md § "Multi-tenancy (Phase 3 — RLS backstop)".
--
-- What this does:
--   1. Creates a NON-superuser role '${APP_ROLE}' (the app should connect as this, NOT the
--      superuser 'offgrid', so RLS is no longer bypassed).
--   2. Enables + FORCEs RLS on every tenant-scoped table and adds an 'org_isolation' policy.
--   3. The policy is a NO-OP while the session GUC '${ORG_GUC}' is unset (backstop dormant,
--      app-level filtering governs) and ENFORCES org isolation once the GUC is set per request.
--
-- Everything is idempotent + guarded (skips a table that is absent or lacks org_id), so it is
-- safe to re-run and safe against code/server schema drift.
-- ============================================================================

-- 1) Non-superuser application role. LOGIN so the app can connect; NOBYPASSRLS is the whole point.
--    Set a real password out-of-band (ALTER ROLE ${APP_ROLE} WITH PASSWORD '...'); do NOT commit it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
    CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE ${APP_ROLE} NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- 2) Baseline grants so the app role can use the schema + existing/future sequences and read the
--    NON-tenant tables (auth/session/config/etc. have no org_id and are shared infra). RLS only
--    gates the tenant tables below; everything else is plain table privileges.
GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${APP_ROLE};

-- 3) Per-table RLS enable + org_isolation policy (tenant-scoped tables only).`;

  const blocks = tables.map(tablePolicySql).join('\n\n');

  const footer = `

-- ============================================================================
-- Verification (run as the app role AFTER switching DATABASE_URL):
--   SET app.current_org_id = 'org-a';
--   SELECT count(*) FROM connectors;              -- only org-a rows
--   RESET app.current_org_id;                     -- GUC unset → backstop dormant (app filtering governs)
-- As the superuser 'offgrid' you would still see everything (BYPASSRLS) — which is exactly why the
-- app must stop connecting as the superuser for the backstop to have any effect.
-- ============================================================================`;

  return `${header}\n\n${blocks}${footer}\n`;
}

// The SQL a request handler would run to scope the connection to one org (the documented `withOrg`
// wrapper). set_config(..., true) = local to the current transaction. Pure so it's testable; the
// I/O wiring (if/when the app adopts it) lives elsewhere.
export function setOrgGucSql(): string {
  return `SELECT set_config('${ORG_GUC}', $1, true)`;
}
