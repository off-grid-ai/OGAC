import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isKeyInOrg, orgFilePrefix } from '../src/lib/files-tenancy.ts';

// Pure tenancy rules for the shared file bucket: a tenant's uploads live under `orgs/<orgId>/`, and
// a viewer in org A must never see org B's files or the global desktop-app junk at the bucket root.

test('orgFilePrefix: a real org → orgs/<org>/ ; default / blank → root (empty)', () => {
  assert.equal(orgFilePrefix('org_bharat'), 'orgs/org_bharat/');
  assert.equal(orgFilePrefix('  org_suraksha '), 'orgs/org_suraksha/'); // trimmed
  assert.equal(orgFilePrefix('default'), '');
  assert.equal(orgFilePrefix(''), '');
  assert.equal(orgFilePrefix('   '), '');
  assert.equal(orgFilePrefix(null), '');
  assert.equal(orgFilePrefix(undefined), '');
});

test('isKeyInOrg: a tenant sees ONLY keys under its own prefix', () => {
  assert.equal(isKeyInOrg('orgs/org_bharat/uuid-statement.pdf', 'org_bharat'), true);
  // The exact leak the fix closes: org A never sees org B's files or root junk.
  assert.equal(isKeyInOrg('orgs/org_suraksha/uuid-policy.pdf', 'org_bharat'), false);
  assert.equal(isKeyInOrg('qwythos9b-frame-001.png', 'org_bharat'), false); // desktop-app junk
  assert.equal(isKeyInOrg('todo-demo/x.json', 'org_bharat'), false);
});

test('isKeyInOrg: a sibling org whose id prefixes another cannot bleed across (trailing / guards it)', () => {
  // 'org_bhar' must not match 'org_bharat' keys — the prefix ends in '/'.
  assert.equal(isKeyInOrg('orgs/org_bharat/x.pdf', 'org_bhar'), false);
});

test('isKeyInOrg: default / single-tenant org sees the WHOLE bucket (unchanged behavior)', () => {
  assert.equal(isKeyInOrg('anything/at/root.png', 'default'), true);
  assert.equal(isKeyInOrg('orgs/org_bharat/x.pdf', 'default'), true);
  assert.equal(isKeyInOrg('flat-key.pdf', null), true);
  assert.equal(isKeyInOrg('flat-key.pdf', ''), true);
});
