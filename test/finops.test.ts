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

// ── B4.10 — the gateway's caller identity must reach the buckets ────────────────────────────────────
//
// Live: totals showed 121 requests / $0.2367 while byKey reported 0 for EVERY key and bySubject was [].
// Cause was one line — analytics.ts discarded the gateway's `caller` (a virtual-key ALIAS or end-user id,
// see litellm-log-shape.ts) and hardcoded keyId: null, so a budget could never be consumed.

test('B4.10: gateway traffic attributes by CALLER ALIAS when no key row id is present', () => {
  const keys: ApiKey[] = [
    // A small budget on purpose: with the seeded $120 budget, $0.018 of real spend is 0.015% and rounds
    // to 0, so a "pct > 0" assertion would be testing the rounding, not the attribution.
    key({ id: 'seedkey_priya', name: 'Priya Sharma (Ops Lead)', subject: 'priya@x.example', budgetUsd: 0.05 }),
  ];
  // Exactly the gateway's shape: no keyId, identity only in `caller`, matched on the key's NAME.
  const events: AuditEvent[] = [
    ev({ id: 'g1', keyId: null, caller: 'Priya Sharma (Ops Lead)', model: 'cloud-claude', tokens: 1000 }),
    ev({ id: 'g2', keyId: null, caller: 'priya@x.example', model: 'cloud-claude', tokens: 1000 }),
  ];
  const f = assembleFinOps(events, keys);
  const k = f.byKey.find((x) => x.id === 'seedkey_priya')!;
  assert.equal(k.requests, 2, 'both calls must land on the key');
  assert.ok(k.costUsd > 0, `spend must be attributed, got ${k.costUsd}`);
  assert.ok((k.pct ?? 0) > 0, `a budget must actually be consumable, got pct=${k.pct} cost=${k.costUsd}`);
});

test('B4.10: bySubject is populated from the caller, not left empty', () => {
  const keys: ApiKey[] = [key({ id: 'k1', name: 'Reimbursement Desk', subjectType: 'team', subject: 'fin-ops' })];
  const events: AuditEvent[] = [
    ev({ id: 'g1', keyId: null, caller: 'Reimbursement Desk' }),
    ev({ id: 'g2', keyId: null, caller: 'trigger:webhook' }), // no key row — still a real identity
  ];
  const f = assembleFinOps(events, keys);
  const labels = f.bySubject.map((b) => b.label);
  assert.ok(labels.includes('team:fin-ops'), JSON.stringify(labels));
  // An identity with no key row is named, not silently dropped.
  assert.ok(labels.includes('trigger:webhook'), JSON.stringify(labels));
});

test('B4.10: the buckets sum to totals — the closing test for this claim', () => {
  const keys: ApiKey[] = [key({ id: 'k1', name: 'Desk', subject: 'desk' })];
  const events: AuditEvent[] = [
    ev({ id: '1', keyId: null, caller: 'Desk', model: 'cloud-claude', tokens: 1000 }),
    ev({ id: '2', keyId: null, caller: 'someone-else', model: 'cloud-claude', tokens: 2000 }),
    ev({ id: '3', keyId: null, caller: null, model: 'cloud-claude', tokens: 500 }),
  ];
  const f = assembleFinOps(events, keys);
  const subjReq = f.bySubject.reduce((a, b) => a + b.requests, 0);
  assert.equal(subjReq, f.totals.requests, 'every request must be attributed somewhere');
  const subjTok = f.bySubject.reduce((a, b) => a + b.tokens, 0);
  assert.equal(subjTok, f.totals.tokens);
});

test('B4.10: unattributable traffic is labelled, and does not borrow another subject', () => {
  const keys: ApiKey[] = [key({ id: 'k1', name: 'Desk', subject: 'desk' })];
  const f = assembleFinOps([ev({ id: '1', keyId: null, caller: null })], keys);
  assert.deepEqual(f.bySubject.map((b) => b.label), ['unattributed']);
  // And it must NOT be credited to the only key present.
  assert.equal(f.byKey.find((k) => k.id === 'k1')!.requests, 0);
});

test('B4.10: a foreign caller still cannot borrow this tenant’s key', () => {
  // The tenant-isolation contract must survive the new alias matching.
  const keys: ApiKey[] = [key({ id: 'surkey', name: 'Claims Automation', subject: 'claims-ops' })];
  const f = assembleFinOps([ev({ id: '1', keyId: null, caller: 'Lending Automation' })], keys);
  assert.equal(f.byKey.find((k) => k.id === 'surkey')!.requests, 0);
  assert.deepEqual(f.bySubject.map((b) => b.label), ['Lending Automation']);
});
