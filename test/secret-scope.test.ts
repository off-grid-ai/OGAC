import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  orgSecretPrefix,
  scopeSecretKey,
  scopeSecretKeyList,
  unscopeSecretKey,
} from '../src/lib/secret-scope.ts';

// PURE unit tests for secret-namespace tenant isolation (SURFACE-2). No I/O. The invariant proven:
// a listing scoped to org A contains ONLY org A's keys, never a sibling `org_*/` folder; and every
// write/delete/read maps into the tenant's own `<org>/` namespace, so a tenant can't reach another's
// secret even by typing an absolute path.

// ─── orgSecretPrefix ───────────────────────────────────────────────────────────
test('orgSecretPrefix: a real org namespaces under "<org>/"; default/empty does not', () => {
  assert.equal(orgSecretPrefix('org_suraksha'), 'org_suraksha/');
  assert.equal(orgSecretPrefix('org_bharat'), 'org_bharat/');
  assert.equal(orgSecretPrefix('default'), '', 'default org is not namespaced (single-tenant)');
  assert.equal(orgSecretPrefix(''), '');
  assert.equal(orgSecretPrefix('   '), '');
  assert.equal(orgSecretPrefix(null), '');
  assert.equal(orgSecretPrefix(undefined), '');
});

// ─── scopeSecretKey (write/delete/read target) ───────────────────────────────────
test('scopeSecretKey: prefixes a tenant-relative key with the org namespace, idempotently', () => {
  assert.equal(scopeSecretKey('org_suraksha', 'connectors/coreins'), 'org_suraksha/connectors/coreins');
  // Idempotent — an already-absolute key for THIS org is not double-prefixed.
  assert.equal(
    scopeSecretKey('org_suraksha', 'org_suraksha/connectors/coreins'),
    'org_suraksha/connectors/coreins',
  );
  // Default org writes bare keys (single-tenant unchanged).
  assert.equal(scopeSecretKey('default', 'connectors/x'), 'connectors/x');
  assert.equal(scopeSecretKey('', 'connectors/x'), 'connectors/x');
});

test('scopeSecretKey: a tenant CANNOT reach another org by typing its absolute path', () => {
  // The insurer typing the bank's absolute path lands INSIDE the insurer's own namespace — never the
  // bank's. This is the isolation guarantee on the write/delete path.
  assert.equal(
    scopeSecretKey('org_suraksha', 'org_bharat/connectors/corebank'),
    'org_suraksha/org_bharat/connectors/corebank',
    'a foreign-looking path is nested under the caller org, not honoured as-is',
  );
});

// ─── unscopeSecretKey (display) ──────────────────────────────────────────────────
test('unscopeSecretKey: strips own prefix; drops foreign + the bare folder marker', () => {
  assert.equal(unscopeSecretKey('org_suraksha', 'org_suraksha/connectors/coreins'), 'connectors/coreins');
  // A sibling tenant's key is NOT ours → dropped (null).
  assert.equal(unscopeSecretKey('org_suraksha', 'org_bharat/connectors/corebank'), null);
  // The bare `<org>/` folder entry itself is not a leaf to display.
  assert.equal(unscopeSecretKey('org_suraksha', 'org_suraksha/'), null);
  // Default org passes keys through unchanged.
  assert.equal(unscopeSecretKey('default', 'connectors/x'), 'connectors/x');
});

// ─── scopeSecretKeyList — the terminal transform the UI renders ──────────────────
test('ISOLATION: a listing for org A contains ONLY org A keys, NEVER a sibling org_*/ folder', () => {
  // Simulate the worst case: the backend returned the WHOLE mount (every tenant's folder + keys).
  const wholeMount = [
    'org_bharat/', // ← the leaking folder QA saw
    'org_bharat/connectors/corebank',
    'org_bharat/tools/cibil',
    'org_suraksha/',
    'org_suraksha/connectors/coreins',
    'org_suraksha/connectors/policyadmin',
  ];

  const insurerView = scopeSecretKeyList('org_suraksha', wholeMount);
  // Only the insurer's own keys, stripped to tenant-relative form.
  assert.deepEqual(insurerView, ['connectors/coreins', 'connectors/policyadmin']);
  // The bank's org folder and keys are ABSENT — the SURFACE-2 leak is closed.
  assert.ok(!insurerView.some((k) => k.includes('org_bharat')), 'no org_bharat anywhere');
  assert.ok(!insurerView.includes('org_suraksha/'), 'no bare namespace folder marker');

  // Symmetry: the bank sees only the bank's keys, never the insurer's.
  const bankView = scopeSecretKeyList('org_bharat', wholeMount);
  assert.deepEqual(bankView, ['connectors/corebank', 'tools/cibil']);
  assert.ok(!bankView.some((k) => k.includes('org_suraksha')), 'no org_suraksha anywhere');
});

test('scopeSecretKeyList: de-dupes, drops non-strings, and passes default-org keys through', () => {
  assert.deepEqual(
    scopeSecretKeyList('org_a', ['org_a/x', 'org_a/x', 'org_a/y', 42, null, 'org_a/']),
    ['x', 'y'],
  );
  // Default org: no prefix → keys pass through (single-tenant unchanged), still de-duped.
  assert.deepEqual(scopeSecretKeyList('default', ['a/b', 'a/b', 'c']), ['a/b', 'c']);
  assert.deepEqual(scopeSecretKeyList('org_a', 'not-an-array'), []);
});
