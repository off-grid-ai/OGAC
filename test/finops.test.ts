import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleFinOps } from '../src/lib/finops.ts';
import type { ApiKey, AuditEvent } from '../src/lib/store.ts';

// FinOps assembly + the tenant-isolation contract. `computeFinOps` scopes keys to the caller's org
// via listApiKeys(orgId); the pure `assembleFinOps` is where "only this tenant's keys/subjects
// appear" is decided — an event whose keyId is NOT in the supplied (org-scoped) key set must fall to
// 'unattributed', never leak the foreign tenant's subject. This test drives that with a mixed set.
// No mocks: real assembly over real fixtures, asserting the projection a user sees on the FinOps page.

const key = (over: Partial<ApiKey>): ApiKey => ({
  id: 'k',
  name: 'K',
  prefix: 'ogak_x',
  subjectType: 'project',
  subject: 's',
  budgetUsd: null,
  enabled: true,
  ...over,
});

const ev = (over: Partial<AuditEvent>): AuditEvent => ({
  id: 'e',
  deviceId: 'd1',
  ts: '2026-07-10T00:00:00.000Z',
  model: 'cloud-claude',
  tokens: 1000,
  leftDevice: false,
  tool: null,
  outcome: 'ok',
  ...over,
});

test('assembleFinOps: a foreign-org key’s traffic is unattributed, never labeled with its subject', () => {
  const insurerKeys: ApiKey[] = [
    key({ id: 'surkey_claims', name: 'Claims Automation', subject: 'claims-ops', budgetUsd: 2500 }),
  ];
  const events: AuditEvent[] = [
    ev({ id: 'e1', keyId: 'surkey_claims', model: 'cloud-claude', tokens: 1000 }), // $0.009
    ev({ id: 'e2', keyId: 'surkey_claims', model: 'gemma-local', tokens: 5000 }), // $0 (local)
    ev({ id: 'e3', keyId: 'bhkey_lending', model: 'cloud-claude', tokens: 2000 }), // foreign org
  ];

  const f = assembleFinOps(events, insurerKeys);

  // byKey shows ONLY the insurer's key — the foreign key is absent entirely.
  assert.deepEqual(
    f.byKey.map((k) => k.id),
    ['surkey_claims'],
  );
  const claims = f.byKey[0];
  assert.equal(claims.subject, 'claims-ops');
  assert.equal(claims.requests, 2); // e1 + e2
  assert.equal(claims.costUsd, 0.009); // only the cloud call is billed; local is free
  assert.equal(claims.pct, 0); // 0.009 / 2500 rounds to 0%

  // bySubject: the insurer subject appears; the foreign event is 'unattributed', and NO bank subject
  // ('lending') leaks into this tenant's view.
  const subjects = f.bySubject.map((b) => b.label);
  assert.ok(subjects.includes('project:claims-ops'));
  assert.ok(subjects.includes('unattributed'));
  assert.ok(!subjects.some((s) => s.includes('lending')));
});

test('assembleFinOps: totals + localShare roll up over all events', () => {
  const events: AuditEvent[] = [
    ev({ id: 'e1', model: 'cloud-claude', tokens: 1000 }),
    ev({ id: 'e2', model: 'gemma-local', tokens: 5000 }),
    ev({ id: 'e3', model: 'gpt-4o', tokens: 1000 }),
  ];
  const f = assembleFinOps(events, []);
  assert.equal(f.totals.requests, 3);
  assert.equal(f.totals.tokens, 7000);
  assert.equal(f.totals.localShare, 33); // 1 of 3 events priced at $0
  // With no keys, every event with a keyId would be unattributed — here none carry a keyId.
  assert.deepEqual(f.byKey, []);
});

test('assembleFinOps: empty inputs yield an empty, non-throwing projection', () => {
  const f = assembleFinOps([], []);
  assert.equal(f.totals.requests, 0);
  assert.equal(f.totals.localShare, 0); // no divide-by-zero
  assert.deepEqual(f.byModel, []);
  assert.deepEqual(f.bySubject, []);
  assert.deepEqual(f.byKey, []);
  assert.deepEqual(f.daily, []);
});
