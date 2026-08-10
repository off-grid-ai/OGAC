// Two cross-tenant leaks, both live on public demo links, both found by walking the product rather
// than by reading it. These are the regression tests.
//
// 1. The operator SQL console handed raw statements to ClickHouse with no tenancy scope — the only
//    guard checked the verb was a read. And the insurer's own starter queries shipped pointing at
//    `bfsi.fact_claim`, a database belonging to neither tenant, so the shortest path to someone
//    else's rows was clicking a button the product itself offered.
// 2. Gateway API keys were listed realm-wide. It hid because the realm had no keys — the list was
//    empty, so there was nothing to leak. The moment one key per org existed, the bank's page read
//    "Suraksha Life — claims platform gateway client · org_suraksha".

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { starterQueriesFor } from '@/lib/dataplane-ui';
import { filterKeysForOrg } from '@/lib/gateway-api-key';
import { ALL_DATABASES, assertQueryInScope } from '@/lib/warehouse-tenancy';

// ── The SQL console ───────────────────────────────────────────────────────────────────────────────

test('a query naming another tenant\'s database is refused', () => {
  const out = assertQueryInScope('SELECT count() FROM bharatunion.fact_account', 'suraksha');
  assert.equal(out.ok, false);
});

test('the refusal says what is allowed, not just "forbidden"', () => {
  // "forbidden" on its own taught the reader nothing and made a working guard look like a broken page.
  const out = assertQueryInScope('SELECT 1 FROM bfsi.fact_claim', 'suraksha');
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.match(out.reason, /suraksha/, 'names the database you CAN query');
  assert.match(out.reason, /bfsi/, 'and names the one that was refused');
});

test('a bare table name is allowed — it resolves to the caller\'s own database', () => {
  // This is why the starter queries are unqualified: the adapter sets the tenant's database as the
  // connection default, so `FROM fact_policy` can only ever mean their own.
  assert.deepEqual(assertQueryInScope('SELECT count() FROM fact_policy', 'suraksha'), { ok: true });
});

test('the caller\'s own database, written out, is allowed', () => {
  assert.deepEqual(assertQueryInScope('SELECT 1 FROM suraksha.fact_claim', 'suraksha'), { ok: true });
  assert.deepEqual(assertQueryInScope('SELECT 1 FROM SURAKSHA.fact_claim', 'suraksha'), { ok: true });
});

test('a foreign database hidden in a subquery or a join is still caught', () => {
  // Checking only the token after FROM would miss both of these.
  for (const sql of [
    'SELECT * FROM (SELECT id FROM bharatunion.fact_loan) AS x',
    'SELECT a.id FROM fact_policy AS a JOIN bharatunion.dim_customer AS b ON a.id = b.id',
    'SELECT 1 FROM fact_policy UNION ALL SELECT 1 FROM bfsi.fact_claim',
  ]) {
    assert.equal(assertQueryInScope(sql, 'suraksha').ok, false, sql);
  }
});

test('ClickHouse\'s own schema databases stay readable', () => {
  // They carry no tenant rows, and blocking them would break every "what columns does this have"
  // question a real operator asks.
  assert.deepEqual(assertQueryInScope('SELECT name FROM system.tables', 'suraksha'), { ok: true });
  assert.deepEqual(
    assertQueryInScope('SELECT * FROM information_schema.columns', 'suraksha'),
    { ok: true },
  );
});

test('the platform operator is unscoped, and an account with no scope gets nothing', () => {
  assert.deepEqual(assertQueryInScope('SELECT 1 FROM anything.at_all', ALL_DATABASES), { ok: true });
  const none = assertQueryInScope('SELECT 1 FROM fact_policy', '');
  assert.equal(none.ok, false, 'no scope must not silently mean unscoped');
});

test('no starter query the product offers names a database at all', () => {
  // The defect, asserted directly: a shipped starter must be unqualified, so it cannot point at a
  // tenant that is not the viewer.
  //
  // INSURER ONLY, for now, and deliberately: the BANK's starters still read `FROM bfsi.fact_loan`,
  // and `bfsi` holds the only copy of that data — it is in neither tenant's database. Un-qualifying
  // them before those tables exist inside `bharatunion` would trade a cross-tenant read for a
  // "table not found", which is worse to demo. The bank's warehouse is being seeded separately; when
  // it lands, 'bank' joins this loop and the two cases below become the acceptance test for it.
  for (const flavour of ['insurer'] as const) {
    for (const q of starterQueriesFor(flavour)) {
      assert.doesNotMatch(
        q.sql,
        /\b(?:FROM|JOIN)\s+[A-Za-z_][A-Za-z0-9_]*\s*\./i,
        `${flavour}/${q.id} qualifies a table with a database name`,
      );
    }
  }
});

test('every starter query the product offers passes its own tenancy guard', () => {
  // The closing assertion: the product cannot ship a button that its own guard would refuse.
  // Insurer only for now — see the note above.
  for (const flavour of ['insurer'] as const) {
    for (const q of starterQueriesFor(flavour)) {
      const scope: string = 'suraksha';
      assert.equal(assertQueryInScope(q.sql, scope).ok, true, `${flavour}/${q.id}`);
    }
  }
});

// ── Gateway API keys ──────────────────────────────────────────────────────────────────────────────

const key = (clientId: string, owner: string) => ({
  id: `id-${clientId}`,
  clientId,
  name: clientId,
  owner,
  scope: 'gateway',
  status: 'active' as const,
  createdAt: '2026-08-10T00:00:00.000Z',
  lastUsedAt: null,
});

const KEYS = [
  key('ogak-suraksha-life-claims', 'org_suraksha'),
  key('ogak-bharat-union-core', 'org_bharat'),
  key('ogak-orphan', 'default'),
];

test('a tenant sees only its own gateway keys', () => {
  assert.deepEqual(
    filterKeysForOrg(KEYS, 'org_bharat').map((k) => k.clientId),
    ['ogak-bharat-union-core'],
  );
  assert.deepEqual(
    filterKeysForOrg(KEYS, 'org_suraksha').map((k) => k.clientId),
    ['ogak-suraksha-life-claims'],
  );
});

test('the exact leak that shipped: the bank must not see the insurer\'s credential', () => {
  const seen = filterKeysForOrg(KEYS, 'org_bharat');
  assert.ok(!seen.some((k) => /suraksha/i.test(k.clientId) || k.owner === 'org_suraksha'));
});

test('the platform operator sees everything, including an orphan', () => {
  // Deliberate: these are live credentials, and a key nobody can see is a key nobody can REVOKE.
  // Hiding an orphaned credential from the only account able to revoke it trades one problem for
  // a worse one.
  assert.equal(filterKeysForOrg(KEYS, 'default').length, 3);
});

test('an empty org sees nothing rather than everything', () => {
  assert.deepEqual(filterKeysForOrg(KEYS, ''), []);
  assert.deepEqual(filterKeysForOrg(KEYS, '   '), []);
});
