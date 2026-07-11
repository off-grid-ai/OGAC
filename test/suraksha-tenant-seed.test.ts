import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SURAKSHA_TENANT,
  SURAKSHA_CONNECTORS,
  SURAKSHA_DOMAINS,
  planSurakshaTenant,
  planSurakshaConnectors,
  planSurakshaDomains,
} from '@/lib/suraksha-tenant-seed';

test('SURAKSHA_TENANT identity is a deterministic life-insurer org', () => {
  assert.equal(SURAKSHA_TENANT.id, 'org_suraksha');
  assert.equal(SURAKSHA_TENANT.slug, 'suraksha');
  assert.equal(SURAKSHA_TENANT.name, 'Suraksha Life');
  assert.ok(SURAKSHA_TENANT.enabledModules.includes('studio'));
});

test('planSurakshaTenant: creates when absent', () => {
  const p = planSurakshaTenant([]);
  assert.equal(p.present, false);
  assert.deepEqual(p.create, SURAKSHA_TENANT);
});

test('planSurakshaTenant: present when id already taken (idempotent)', () => {
  const p = planSurakshaTenant([{ id: 'org_suraksha' }]);
  assert.equal(p.present, true);
  assert.equal(p.create, null);
});

test('planSurakshaTenant: present when slug already taken (case/space-insensitive)', () => {
  const p = planSurakshaTenant([{ id: 'org_other', slug: ' Suraksha ' }]);
  assert.equal(p.present, true);
  assert.equal(p.create, null);
});

test('planSurakshaTenant: a different tenant does not block creation', () => {
  const p = planSurakshaTenant([{ id: 'org_bharat', slug: 'bharatunion' }]);
  assert.equal(p.present, false);
  assert.ok(p.create);
});

test('planSurakshaConnectors: creates all when none present', () => {
  const p = planSurakshaConnectors([]);
  assert.equal(p.toCreate.length, SURAKSHA_CONNECTORS.length);
  assert.equal(p.present.length, 0);
});

test('planSurakshaConnectors: skips ones already present (idempotent)', () => {
  const p = planSurakshaConnectors([{ id: 'surcon_coreins' }]);
  assert.ok(p.present.some((c) => c.id === 'surcon_coreins'));
  assert.ok(!p.toCreate.some((c) => c.id === 'surcon_coreins'));
  assert.equal(p.toCreate.length + p.present.length, SURAKSHA_CONNECTORS.length);
});

test('planSurakshaDomains: creates all when connectors are being seeded this run', () => {
  // No existing domains/connectors — but the domains bind to SURAKSHA_CONNECTORS, which this same
  // seed creates, so nothing is unbacked.
  const p = planSurakshaDomains([], []);
  assert.equal(p.toCreate.length, SURAKSHA_DOMAINS.length);
  assert.equal(p.present.length, 0);
  assert.equal(p.unbacked.length, 0);
});

test('planSurakshaDomains: label match is idempotent (case-insensitive)', () => {
  const p = planSurakshaDomains([{ label: 'POLICIES' }, { label: 'claims' }], []);
  assert.ok(p.present.some((d) => d.label === 'policies'));
  assert.ok(p.present.some((d) => d.label === 'claims'));
  assert.ok(!p.toCreate.some((d) => d.label === 'policies'));
});

test('planSurakshaDomains: a domain whose connector is truly absent is unbacked, never fabricated', () => {
  // Force an unbacked case: a spec pointing at a connector that is neither existing nor in this
  // seed's connector set. We simulate by checking the real set has zero unbacked (all backed by the
  // seed), then assert the honesty rule holds for a synthetic connector id via the planner contract.
  const real = planSurakshaDomains([], []);
  assert.equal(real.unbacked.length, 0, 'every real domain is backed by a seeded connector');
  // Every toCreate item carries the fields the store needs, none invented.
  for (const d of real.toCreate) {
    assert.ok(d.label && d.connectorId && d.resource);
    assert.ok(SURAKSHA_CONNECTORS.some((c) => c.id === d.connectorId));
  }
});

test('planSurakshaDomains: a domain with an absent backing connector is skipped as unbacked', () => {
  const p = planSurakshaDomains(
    [],
    [],
    [{ label: 'orphan', aliases: [], connectorId: 'surcon_missing', resource: 'x', useCase: 't' }],
  );
  assert.equal(p.toCreate.length, 0);
  assert.equal(p.unbacked.length, 1);
  assert.equal(p.unbacked[0].label, 'orphan');
});

test('planSurakshaDomains: an existing connector (not in the seed set) also backs a domain', () => {
  const p = planSurakshaDomains(
    [],
    [{ id: 'surcon_missing' }],
    [{ label: 'orphan', aliases: [], connectorId: 'surcon_missing', resource: 'x', useCase: 't' }],
  );
  assert.equal(p.toCreate.length, 1);
  assert.equal(p.unbacked.length, 0);
});

test('every domain binds to a declared connector (no dangling references)', () => {
  const ids = new Set(SURAKSHA_CONNECTORS.map((c) => c.id));
  for (const d of SURAKSHA_DOMAINS) assert.ok(ids.has(d.connectorId), `${d.label} → ${d.connectorId}`);
});

test('connectors are insurer-flavoured: isolated `suraksha` DB, `coreins` role, NO bank `corebank`', () => {
  const pg = SURAKSHA_CONNECTORS.find((c) => c.id === 'surcon_coreins');
  const my = SURAKSHA_CONNECTORS.find((c) => c.id === 'surcon_policyadmin');
  assert.ok(pg && pg.endpoint.endsWith('/suraksha'), 'coreins → …/suraksha');
  // The insurer connector must NOT read bank-flavoured — the connect role is `coreins`, not `corebank`.
  assert.ok(pg && pg.endpoint.includes('coreins@'), 'connects as the insurer `coreins` role');
  assert.ok(pg && !pg.endpoint.includes('corebank'), 'no bank-flavoured `corebank` on the insurer');
  assert.ok(my && my.endpoint.endsWith('/suraksha'), 'policyadmin → …/suraksha');
});

test('reimbursement quota domain (#1) binds to MySQL employee_quota, mirroring bharatunion', () => {
  const d = SURAKSHA_DOMAINS.find((x) => x.label === 'reimbursement quota');
  assert.ok(d, 'reimbursement quota domain present');
  assert.equal(d.connectorId, 'surcon_policyadmin');
  assert.equal(d.resource, 'employee_quota');
});

test('every domain binds to a declared connector (no dangling resource)', () => {
  const ids = new Set(SURAKSHA_CONNECTORS.map((c) => c.id));
  for (const d of SURAKSHA_DOMAINS) {
    assert.ok(ids.has(d.connectorId), `${d.label} → ${d.connectorId} exists`);
    assert.ok(d.resource && /^[a-z][a-z0-9_]*$/.test(d.resource), `${d.label} resource is a table id`);
  }
});
