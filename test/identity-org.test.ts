import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orgFrom } from '@/lib/auth/identity';

// Pure org-claim reader. ZERO IO — proves the precedence of claim shapes (top-level `org` >
// `organization` string > `organization` group array), trimming, and the undefined fallback when no
// org claim is present. This is the load-bearing input to tenant-org binding: a wrong or absent org
// means a viewer either binds to the wrong tenant or (safely) to none, so every corner is asserted.

test('orgFrom: reads a top-level `org` claim (the canonical mapper output)', () => {
  assert.equal(orgFrom({ org: 'org_bharat' }), 'org_bharat');
  assert.equal(orgFrom({ org: 'org_suraksha' }), 'org_suraksha');
});

test('orgFrom: falls back to an `organization` string claim when `org` is absent', () => {
  assert.equal(orgFrom({ organization: 'org_bharat' }), 'org_bharat');
});

test('orgFrom: reads the first entry of an `organization` group array', () => {
  assert.equal(orgFrom({ organization: ['org_suraksha', 'org_other'] }), 'org_suraksha');
});

test('orgFrom: top-level `org` wins over `organization` (precedence)', () => {
  assert.equal(orgFrom({ org: 'org_bharat', organization: 'org_suraksha' }), 'org_bharat');
  assert.equal(orgFrom({ org: 'org_bharat', organization: ['org_suraksha'] }), 'org_bharat');
});

test('orgFrom: trims surrounding whitespace on every shape', () => {
  assert.equal(orgFrom({ org: '  org_bharat  ' }), 'org_bharat');
  assert.equal(orgFrom({ organization: '  org_suraksha ' }), 'org_suraksha');
  assert.equal(orgFrom({ organization: ['  org_bharat  '] }), 'org_bharat');
});

test('orgFrom: blank/empty claims are treated as absent, falling through', () => {
  // blank top-level org falls through to the organization string
  assert.equal(orgFrom({ org: '   ', organization: 'org_suraksha' }), 'org_suraksha');
  // blank org + blank organization string → undefined
  assert.equal(orgFrom({ org: '', organization: '  ' }), undefined);
  // a group array of only blank/non-string entries → undefined
  assert.equal(orgFrom({ organization: ['  ', '', 42] }), undefined);
});

test('orgFrom: returns undefined when no org claim is present (default-org fallback)', () => {
  assert.equal(orgFrom({}), undefined);
  assert.equal(orgFrom({ sub: 'user-1', email: 'v@x.io', role: 'viewer' }), undefined);
});

test('orgFrom: non-string, non-array org values are ignored', () => {
  assert.equal(orgFrom({ org: 42 }), undefined);
  assert.equal(orgFrom({ org: { nested: 'x' } }), undefined);
  assert.equal(orgFrom({ organization: 99 }), undefined);
});
