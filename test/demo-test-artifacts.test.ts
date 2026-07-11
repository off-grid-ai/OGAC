import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUTOTEST_ACTOR,
  DEMO_TENANT_ORG_IDS,
  hideDemoTestArtifact,
  isAutotestActor,
  isAutotestTitle,
  isDemoTenantOrg,
} from '../src/lib/demo-test-artifacts.ts';

// PURE tests — the ONE place that decides "is this a QA test artifact on a demo tenant?". These pin
// the exact match rules the Studio grid / Reports / Review / audit-log filters all rely on.

test('DEMO_TENANT_ORG_IDS is exactly the two customer-facing demo tenants', () => {
  assert.deepEqual([...DEMO_TENANT_ORG_IDS].sort(), ['org_bharat', 'org_suraksha']);
});

test('isDemoTenantOrg: true only for the demo orgs; false for null/unknown', () => {
  assert.equal(isDemoTenantOrg('org_bharat'), true);
  assert.equal(isDemoTenantOrg('org_suraksha'), true);
  assert.equal(isDemoTenantOrg('org_acme'), false);
  assert.equal(isDemoTenantOrg(null), false);
  assert.equal(isDemoTenantOrg(undefined), false);
});

test('isAutotestActor: matches bare `autotest` and `autotest@offgrid`, case/space-insensitive', () => {
  assert.equal(isAutotestActor('autotest'), true);
  assert.equal(isAutotestActor(AUTOTEST_ACTOR), true);
  assert.equal(isAutotestActor('  Autotest@OffGrid  '), true);
  assert.equal(isAutotestActor('viewer@bharatunion.demo'), false);
  assert.equal(isAutotestActor(''), false);
  assert.equal(isAutotestActor(null), false);
});

test('isAutotestTitle: matches the `[autotest]` prefix, any casing/leading space', () => {
  assert.equal(isAutotestTitle('[autotest] Reimbursement approval'), true);
  assert.equal(isAutotestTitle('  [AutoTest] Death claim'), true);
  assert.equal(isAutotestTitle('Reimbursement approval'), false);
  assert.equal(isAutotestTitle('Report [autotest] mid-string'), false); // must be a prefix
  assert.equal(isAutotestTitle(null), false);
});

test('hideDemoTestArtifact: hides autotest entities ONLY on demo tenants', () => {
  const at = { title: '[autotest] X', ownerId: 'autotest' };
  const real = { title: 'Policy Underwriting Assist', ownerId: 'underwriting@suraksha.example' };
  // Demo tenant → hide autotest, keep real.
  assert.equal(hideDemoTestArtifact('org_suraksha', at), true);
  assert.equal(hideDemoTestArtifact('org_suraksha', real), false);
  // Non-demo tenant → never hide, even an autotest-looking row (behaviour-preserving).
  assert.equal(hideDemoTestArtifact('org_acme', at), false);
  // Actor field also triggers the hide on a demo tenant.
  assert.equal(hideDemoTestArtifact('org_bharat', { actor: AUTOTEST_ACTOR }), true);
});
