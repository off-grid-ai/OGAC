// The tenant ADMIN LIST boundary — the second confirmed cross-tenant leak fixed 2026-08-05.
//
// `/operations/admin/tenants` (and its API, `GET /api/v1/admin/tenants`) rendered every tenant's
// name/host/plan identically on both public demo tenants: a read-only viewer signed into either the
// insurer's or the bank's console learned who the other customers were. `listTenants()` returns the
// WHOLE platform directory with no org awareness at all, so the boundary has to be a decision the
// caller applies — `visibleTenants` (read) and `mayManageTenant` (write) in tenancy-policy.ts.
//
// Shaped like test/audit-tenant-boundary.test.ts and test/langfuse-tenancy.test.ts (the first two
// leaks of the same class): no mocks, real returned values, the property that actually failed in
// production asserted directly (disjoint result sets, fail-closed on an unresolved org).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_DESTINATIONS } from '@/lib/operations-destinations';
import {
  DEFAULT_ORG,
  isPlatformOperatorOrg,
  mayManageTenant,
  visibleDestinations,
  visibleTenants,
} from '../src/lib/tenancy-policy.ts';

const INSURER = 'org_suraksha';
const BANK = 'org_bharat';

const tenants = [
  { id: INSURER, name: 'Suraksha Life', slug: 'suraksha' },
  { id: BANK, name: 'Bharat Union Bank', slug: 'bharatunion' },
  { id: 'org_third', name: 'A third customer', slug: 'third' },
];

test('a tenant member sees only their own tenant row', () => {
  assert.deepEqual(
    visibleTenants(tenants, INSURER).map((t) => t.id),
    [INSURER],
  );
  assert.deepEqual(
    visibleTenants(tenants, BANK).map((t) => t.id),
    [BANK],
  );
});

test('the two demo tenants’ visible sets are disjoint — the exact property that failed live', () => {
  // Live finding: both demo viewers saw the SAME three rows, byte-identical. That must now be
  // impossible — asserted as disjointness so it holds regardless of how the tenant list grows.
  const insurerView = visibleTenants(tenants, INSURER);
  const bankView = visibleTenants(tenants, BANK);
  const overlap = insurerView.filter((a) => bankView.some((b) => b.id === a.id));
  assert.equal(overlap.length, 0);
  assert.notDeepEqual(insurerView, bankView);
});

test('a genuine platform operator (DEFAULT_ORG) sees every tenant', () => {
  // This is the existing tenant-provisioning surface — a platform operator not bound to any tenant
  // subdomain must keep the full directory, or the feature has no one left who can use it.
  assert.deepEqual(
    visibleTenants(tenants, DEFAULT_ORG).map((t) => t.id),
    [INSURER, BANK, 'org_third'],
  );
});

test('an org with no matching tenant row sees nothing — never "all" as a fallback', () => {
  // A caller whose org resolves to something that isn't in the tenant table at all (a bug upstream,
  // a stale claim) must not fall back to the unscoped view — that fallback IS the leak.
  assert.equal(visibleTenants(tenants, 'org_unknown').length, 0);
  assert.equal(visibleTenants(tenants, '').length, 0);
});

test('one tenant cannot see another by any id shape — exact match, never a prefix', () => {
  assert.equal(visibleTenants(tenants, 'org_bharat_test').length, 0);
  assert.equal(
    visibleTenants([{ id: 'org_bharat_test', name: 'lookalike', slug: null }], BANK).length,
    0,
  );
});

// ── mayManageTenant — the WRITE side (PATCH/DELETE /api/v1/admin/tenants/[id]) ─────────────────────

test('a tenant may manage its own row', () => {
  assert.equal(mayManageTenant(INSURER, INSURER), true);
  assert.equal(mayManageTenant(BANK, BANK), true);
});

test('a tenant may NOT manage another tenant’s row — the write-side IDOR this closes', () => {
  // Before this fix, PATCH/DELETE took the id from the URL with no org check at all: any caller who
  // cleared requireAdmin could edit or delete ANOTHER tenant's row by guessing its id.
  assert.equal(mayManageTenant(INSURER, BANK), false);
  assert.equal(mayManageTenant(BANK, INSURER), false);
});

test('a platform operator (DEFAULT_ORG) may manage every tenant', () => {
  assert.equal(mayManageTenant(DEFAULT_ORG, INSURER), true);
  assert.equal(mayManageTenant(DEFAULT_ORG, BANK), true);
  assert.equal(mayManageTenant(DEFAULT_ORG, 'org_anything'), true);
});

test('a blank/unresolved caller org may not manage any real tenant — fails closed', () => {
  assert.equal(mayManageTenant('', INSURER), false);
  assert.equal(mayManageTenant('org_unknown', INSURER), false);
});

// ─── The tenant-provisioning SURFACE, not just its rows ──────────────────────────────────────────
//
// This was first fixed by scoping the tenant LIST so a customer saw only its own row. That closed the
// disclosure and left the wrong product: a page titled "Tenants — provision and remove tenant
// organizations" containing exactly one row, themselves. It tells a customer they are one of several on
// shared infrastructure, invites "who else is in here?", and offers provisioning controls a tenant must
// never operate. So the whole destination is platform-operator-only now.

test('a tenant never sees the tenant-provisioning destination', () => {
  const DESTS = [
    { id: 'organization' },
    { id: 'tenants', operatorOnly: true },
  ] as const;
  for (const org of ['org_suraksha', 'org_bharat']) {
    const ids = visibleDestinations(DESTS, org).map((d) => d.id);
    assert.ok(!ids.includes('tenants'), `${org} must not see the tenants destination`);
    assert.ok(ids.includes('organization'), 'unmarked destinations stay visible');
  }
});

test('the platform operator still sees everything', () => {
  // The surface has to keep working for whoever actually provisions tenants, or the fix breaks the job.
  const DESTS = [{ id: 'organization' }, { id: 'tenants', operatorOnly: true }] as const;
  assert.deepEqual(
    visibleDestinations(DESTS, DEFAULT_ORG).map((d) => d.id),
    ['organization', 'tenants'],
  );
});

test('operatorOnly is opt-in, so it can only ever remove — never grant', () => {
  // A destination with no flag is visible to everyone. This matters because the alternative default
  // (allow-list) would silently hide every NEW destination from tenants the moment someone added one.
  const DESTS = [{ id: 'a' }, { id: 'b', operatorOnly: false }, { id: 'c', operatorOnly: true }] as const;
  assert.deepEqual(visibleDestinations(DESTS, 'org_bharat').map((d) => d.id), ['a', 'b']);
});

test('the real ADMIN_DESTINATIONS marks tenants operator-only and leaves a tenant something to see', () => {
  // Against the SHIPPED array, not a fixture — so this fails if someone adds a tenant-provisioning
  // destination without the flag, or marks everything operator-only and leaves a tenant an empty page.
  const forTenant = visibleDestinations(ADMIN_DESTINATIONS, 'org_suraksha');
  assert.ok(!forTenant.some((d) => d.id === 'tenants'));
  assert.ok(forTenant.length > 0, 'a tenant must still have at least one admin destination');
  assert.equal(visibleDestinations(ADMIN_DESTINATIONS, DEFAULT_ORG).length, ADMIN_DESTINATIONS.length);
});

test('isPlatformOperatorOrg names the same rule the rest of the boundary uses', () => {
  // One definition of "platform operator", shared by visibleTenants / mayManageTenant /
  // visibleDestinations. Two definitions that drift is how a boundary quietly opens.
  assert.equal(isPlatformOperatorOrg(DEFAULT_ORG), true);
  for (const org of [INSURER, BANK, '', 'not-default']) {
    assert.equal(isPlatformOperatorOrg(org), false, `${org} is not the platform operator`);
  }
});
