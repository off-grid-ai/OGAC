import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_ORG, resolveOrg } from '../src/lib/tenancy-policy.ts';

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
