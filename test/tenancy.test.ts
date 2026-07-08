import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_ORG, bindTenantOrg, resolveOrg } from '../src/lib/tenancy-policy.ts';

// Unit tests for the org-resolution rule — pure function, NO mocks. Exercises the real
// precedence policy that governs tenant isolation, so a regression here is caught directly.

test('resolveOrg: env override wins over everything', () => {
  assert.equal(resolveOrg('acme', 'pinned-org'), 'pinned-org');
  assert.equal(resolveOrg(undefined, 'pinned-org'), 'pinned-org');
});

test('resolveOrg: falls back to the claim when no override', () => {
  assert.equal(resolveOrg('acme'), 'acme');
  assert.equal(resolveOrg('acme', ''), 'acme'); // blank override ignored
  assert.equal(resolveOrg('  acme  '), 'acme'); // trimmed
});

test('resolveOrg: defaults when no override and no usable claim', () => {
  assert.equal(resolveOrg(undefined), DEFAULT_ORG);
  assert.equal(resolveOrg(null), DEFAULT_ORG);
  assert.equal(resolveOrg(''), DEFAULT_ORG);
  assert.equal(resolveOrg('   '), DEFAULT_ORG);
  assert.equal(resolveOrg(42), DEFAULT_ORG); // non-string claim
});

test('resolveOrg: two principals in different orgs never collide', () => {
  const a = resolveOrg('org-a');
  const b = resolveOrg('org-b');
  assert.notEqual(a, b);
  assert.equal(a, 'org-a');
  assert.equal(b, 'org-b');
});

// ── bindTenantOrg — the subdomain hard-binding rule (G-F1) ──────────────────────────────────────────
// Pure decision over (host tenant org, the actor's own org, the actor's role). The adapter in
// tenancy.ts feeds this the SAME principal the authz gates verify — session OR verified bearer.

test('bindTenantOrg: admin actor on a tenant subdomain binds the tenant org', () => {
  // Covers the break-glass admin token and a console-admin service account (both resolve role=admin
  // via requireUser) — the exact G-F1 bearer path that used to fall back to default.
  assert.equal(bindTenantOrg('org_bharat', DEFAULT_ORG, 'admin'), 'org_bharat');
});

test('bindTenantOrg: unauthorized (non-admin, non-member) actor is refused — no cross-tenant leak', () => {
  assert.equal(bindTenantOrg('org_bharat', DEFAULT_ORG, 'viewer'), DEFAULT_ORG);
  assert.equal(bindTenantOrg('org_bharat', DEFAULT_ORG, 'svc-gateway'), DEFAULT_ORG);
  assert.equal(bindTenantOrg('org_bharat', 'org_other', undefined), 'org_other');
  assert.equal(bindTenantOrg('org_bharat', DEFAULT_ORG, undefined), DEFAULT_ORG);
});

test('bindTenantOrg: an actor already IN the org binds it regardless of role (member path)', () => {
  assert.equal(bindTenantOrg('org_bharat', 'org_bharat', 'viewer'), 'org_bharat');
  assert.equal(bindTenantOrg('org_bharat', 'org_bharat', undefined), 'org_bharat');
});

test('bindTenantOrg: off a tenant subdomain the actor keeps their own org (session path unchanged)', () => {
  assert.equal(bindTenantOrg(null, DEFAULT_ORG, 'admin'), DEFAULT_ORG);
  assert.equal(bindTenantOrg(null, 'org_x', 'viewer'), 'org_x');
  assert.equal(bindTenantOrg(null, 'org_x', undefined), 'org_x');
});
