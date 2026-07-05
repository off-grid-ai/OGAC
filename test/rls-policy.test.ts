import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APP_ROLE,
  buildRlsMigrationSql,
  isSafeIdentifier,
  ORG_GUC,
  orgIsolationPredicate,
  setOrgGucSql,
  tablePolicySql,
  TENANT_SCOPED_TABLES,
} from '../src/lib/rls-policy.ts';

// Unit tests for the PURE RLS-policy SQL generator — no DB, no mocks. Asserts the migration is the
// shape a reviewer expects: non-superuser role, per-table RLS, GUC-dormant-by-default predicate.

test('TENANT_SCOPED_TABLES are all safe SQL identifiers and unique', () => {
  const seen = new Set<string>();
  for (const t of TENANT_SCOPED_TABLES) {
    assert.equal(isSafeIdentifier(t), true, `unsafe: ${t}`);
    assert.equal(seen.has(t), false, `duplicate: ${t}`);
    seen.add(t);
  }
  // The list the SERVER_STATE note calls out (~18 tenant tables; 13 are in the code schema today).
  assert.equal(TENANT_SCOPED_TABLES.length, 13);
});

test('isSafeIdentifier rejects injection / bad shapes', () => {
  assert.equal(isSafeIdentifier('connectors'), true);
  assert.equal(isSafeIdentifier('agent_runs'), true);
  assert.equal(isSafeIdentifier('Connectors'), false); // uppercase not allowed (unquoted lower)
  assert.equal(isSafeIdentifier('drop table x;--'), false);
  assert.equal(isSafeIdentifier('a b'), false);
  assert.equal(isSafeIdentifier('public.connectors'), false); // no schema qualifier
  assert.equal(isSafeIdentifier(''), false);
  assert.equal(isSafeIdentifier(null), false);
  assert.equal(isSafeIdentifier('a'.repeat(64)), false); // > 63
});

test('orgIsolationPredicate is dormant when the GUC is unset, strict when set', () => {
  const p = orgIsolationPredicate();
  // Uses missing_ok current_setting so an unset GUC → NULL → the OR arm makes it a no-op.
  assert.match(p, /current_setting\('app\.current_org_id', true\)/);
  assert.match(p, /org_id = current_setting\('app\.current_org_id', true\)/);
  assert.match(p, /IS NULL/);
  assert.equal(ORG_GUC, 'app.current_org_id');
});

test('tablePolicySql: guarded, forces RLS, drops-then-creates the org_isolation policy', () => {
  const sql = tablePolicySql('connectors');
  assert.match(sql, /to_regclass\('public\.connectors'\)/); // existence guard
  assert.match(sql, /column_name = 'org_id'/); // has-org_id guard
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/); // force so the table owner is also gated
  assert.match(sql, /DROP POLICY IF EXISTS org_isolation ON public\.connectors/); // idempotent
  assert.match(sql, /CREATE POLICY org_isolation ON public\.connectors FOR ALL TO offgrid_app/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.connectors TO offgrid_app/);
});

test('tablePolicySql rejects an unsafe table name (defensive)', () => {
  assert.throws(() => tablePolicySql('foo; drop table bar'), /unsafe table identifier/);
});

test('buildRlsMigrationSql: creates a non-superuser NOBYPASSRLS role and covers every table', () => {
  const sql = buildRlsMigrationSql();
  // Role: LOGIN, explicitly NOSUPERUSER + NOBYPASSRLS (the whole point of the backstop).
  assert.match(sql, /CREATE ROLE offgrid_app LOGIN NOSUPERUSER NOBYPASSRLS/);
  assert.match(sql, /ALTER ROLE offgrid_app NOSUPERUSER NOBYPASSRLS/); // idempotent re-run path
  assert.equal(APP_ROLE, 'offgrid_app');
  // Baseline grants so non-tenant (auth/session/config) tables still work under the app role.
  assert.match(sql, /GRANT USAGE ON SCHEMA public TO offgrid_app/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES IN SCHEMA public/);
  // Every tenant table appears with its own policy block.
  for (const t of TENANT_SCOPED_TABLES) {
    assert.match(sql, new RegExp(`CREATE POLICY org_isolation ON public\\.${t} `), `missing policy: ${t}`);
  }
  // Documents that it is NOT auto-run.
  assert.match(sql, /NOT auto-run/);
});

test('buildRlsMigrationSql accepts a custom table list and rejects unsafe entries', () => {
  const sql = buildRlsMigrationSql(['connectors']);
  assert.match(sql, /CREATE POLICY org_isolation ON public\.connectors /);
  assert.doesNotMatch(sql, /public\.agent_runs/);
  assert.throws(() => buildRlsMigrationSql(['ok', 'bad;name']), /unsafe table identifier/);
});

test('setOrgGucSql is a transaction-local set_config with a bound param', () => {
  assert.equal(setOrgGucSql(), "SELECT set_config('app.current_org_id', $1, true)");
});
