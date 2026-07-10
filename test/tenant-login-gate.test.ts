import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayLoginToTenant } from '../src/lib/tenancy-policy.ts';

test('mayLoginToTenant: a member of the tenant may sign in', () => {
  assert.equal(mayLoginToTenant('org_bharat', 'org_bharat', 'viewer'), true);
});

test('mayLoginToTenant: the SAME creds cannot log into the OTHER tenant (bank user on insurer host)', () => {
  // demo-bank (org_bharat) attempting the suraksha (org_suraksha) host -> rejected like a bad password
  assert.equal(mayLoginToTenant('org_suraksha', 'org_bharat', 'viewer'), false);
});

test('mayLoginToTenant: admin may sign in on any tenant host', () => {
  assert.equal(mayLoginToTenant('org_suraksha', 'org_bharat', 'admin'), true);
});

test('mayLoginToTenant: a user with no org is rejected on a tenant host (fail safe)', () => {
  assert.equal(mayLoginToTenant('org_bharat', undefined, 'viewer'), false);
  assert.equal(mayLoginToTenant('org_bharat', null, 'viewer'), false);
});

test('mayLoginToTenant: off a tenant subdomain (apex / single-tenant) there is no gate', () => {
  assert.equal(mayLoginToTenant(null, 'org_bharat', 'viewer'), true);
  assert.equal(mayLoginToTenant(null, undefined, undefined), true);
});
