import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertAllowed, ALLOWED_ORGS, identity, domainsFor } from '../src/lib/demo/seed-guard.ts';
import { BHARAT_PROFILE, SURAKSHA_PROFILE } from '../src/lib/tour-demo-seed.ts';

// PURE unit tests for the seed's SAFETY guard + tenant-identity mappers. The guard is the load-bearing
// safety rule: the seed must NEVER write to `default` or `wednesdaysol`. Real functions, no mocks.

test('ALLOWED_ORGS is exactly the two demo tenants — never default/wednesdaysol', () => {
  assert.deepEqual([...ALLOWED_ORGS].sort(), ['org_bharat', 'org_suraksha']);
});

test('assertAllowed passes for the two demo tenants', () => {
  assert.doesNotThrow(() => assertAllowed('org_bharat'));
  assert.doesNotThrow(() => assertAllowed('org_suraksha'));
});

test('assertAllowed REFUSES default, wednesdaysol, and any other org', () => {
  for (const bad of ['default', 'wednesdaysol', 'org_other', '']) {
    assert.throws(() => assertAllowed(bad), /refusing to write/, `must refuse "${bad}"`);
  }
});

test('identity reads bharatunion as a BANK and suraksha as an INSURER', () => {
  const bank = identity(BHARAT_PROFILE);
  const insurer = identity(SURAKSHA_PROFILE);
  assert.equal(bank.name, 'Bharat Union');
  assert.equal(insurer.name, 'Suraksha Life');
  assert.ok(bank.connectors.length >= 1, 'bank has connectors');
  assert.ok(insurer.connectors.length >= 1, 'insurer has connectors');
  // Distinct source systems — a bank connector set differs from an insurer's.
  const bankIds = new Set(bank.connectors.map((c) => c.id));
  assert.equal(insurer.connectors.filter((c) => bankIds.has(c.id)).length, 0, 'no shared connector ids');
});

test('domainsFor returns bound domains per flavour', () => {
  assert.ok(domainsFor(BHARAT_PROFILE).length >= 1);
  assert.ok(domainsFor(SURAKSHA_PROFILE).length >= 1);
  for (const d of [...domainsFor(BHARAT_PROFILE), ...domainsFor(SURAKSHA_PROFILE)]) {
    assert.ok(d.label && d.connectorId && d.resource, 'each domain has a label/connector/resource');
  }
});
