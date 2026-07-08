import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planCloudRoute } from '../src/lib/cloud-routing.ts';
import type { RoutingDecision } from '../src/lib/routing-policy.ts';
import type { CloudProviderConfig } from '../src/lib/cloud-providers.ts';
import { egressAuditEvent, egressBlockedAuditEvent } from '../src/lib/cloud-egress-audit.ts';
import type { CloudPlan } from '../src/lib/cloud-routing.ts';
import type { Actor } from '../src/lib/audit-event.ts';
import { resolveRtbfScope, type RtbfAsset } from '../src/lib/data-rtbf.ts';
import { evaluateRetention, normalizeRetentionAction } from '../src/lib/data-retention.ts';

// ─── cloud-routing.planCloudRoute — hit the `||`/`??` fallback ALTERNATES ─────────────────────
const dec = (o: Partial<RoutingDecision>): RoutingDecision =>
  ({ effective: 'local', reason: '', model: null, fallback: 'local', ...o }) as RoutingDecision;

test('block plan with EMPTY reason falls back to the default reason string', () => {
  const p = planCloudRoute(dec({ effective: 'block', reason: '' }), [], true);
  assert.equal(p.kind, 'block');
  assert.equal(p.reason, 'blocked by routing policy');
});

test('block plan keeps a PRESENT reason', () => {
  const p = planCloudRoute(dec({ effective: 'block', reason: 'pii leash' }), [], true);
  assert.equal(p.reason, 'pii leash');
});

test('local plan: null model + empty reason use defaults; present values pass through', () => {
  const a = planCloudRoute(dec({ effective: 'local', model: null, reason: '' }), [], true);
  assert.equal(a.kind, 'local');
  assert.equal(a.model, null);
  assert.equal(a.reason, 'routed local');
  const b = planCloudRoute(dec({ effective: 'local', model: 'gemma-local', reason: 'stay' }), [], true);
  assert.equal(b.model, 'gemma-local');
  assert.equal(b.reason, 'stay');
});

const providers: CloudProviderConfig[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://x',
    apiKey: 'k',
    prefixes: ['openai'],
    defaultModel: 'gpt-4o-mini',
  } as unknown as CloudProviderConfig,
];

test('cloud plan with a selectable provider: reason default AND present variants', () => {
  const def = planCloudRoute(dec({ effective: 'cloud', model: 'gpt-4o-mini', reason: '' }), providers, true);
  assert.equal(def.kind, 'cloud');
  assert.ok(def.reason.startsWith('routed cloud →'));
  const named = planCloudRoute(dec({ effective: 'cloud', model: 'gpt-4o-mini', reason: 'egress ok' }), providers, true);
  assert.ok(named.reason.startsWith('egress ok →'));
});

test('cloud with NO provider: fallback=block blocks; default local falls back honestly', () => {
  const blocked = planCloudRoute(dec({ effective: 'cloud', model: 'x', fallback: 'block' }), [], true);
  assert.equal(blocked.kind, 'block');
  assert.equal(blocked.cloudUnavailable, true);
  const fell = planCloudRoute(dec({ effective: 'cloud', model: 'x', fallback: undefined }), [], true);
  assert.equal(fell.kind, 'local');
  assert.equal(fell.cloudUnavailable, true);
});

test('cloud decision with egress OFF is hard-stopped regardless of providers', () => {
  const p = planCloudRoute(dec({ effective: 'cloud', model: 'gpt-4o-mini' }), providers, false);
  assert.equal(p.kind, 'block');
  assert.match(p.reason, /egress is OFF/);
});

// ─── cloud-egress-audit — plan.selection present vs absent ────────────────────────────────────
const actor: Actor = { type: 'user', id: 'u1', email: 'a@b.co' } as unknown as Actor;
const ctx = { actor, org: 'acme', project: 'p1', runId: 'r1' };

test('egressAuditEvent with a selection namespaces the model + provider resource', () => {
  const plan: CloudPlan = {
    kind: 'cloud',
    selection: { provider: { id: 'openai' }, model: 'gpt-4o-mini' } as unknown as CloudPlan['selection'],
    cloudUnavailable: false,
    model: 'gpt-4o-mini',
    reason: 'x',
  };
  const ev = egressAuditEvent(ctx, plan, { promptTokens: 10, completionTokens: 5 }, 'ok');
  assert.equal(ev.model, 'openai:gpt-4o-mini');
  assert.equal(ev.resource, 'provider:openai');
  assert.equal(ev.tokens?.total, 15);
});

test('egressAuditEvent with NO selection falls back to generic "cloud" + clamps negative tokens', () => {
  const plan: CloudPlan = { kind: 'cloud', selection: null, cloudUnavailable: true, model: null, reason: 'x' };
  const ev = egressAuditEvent({ actor, org: 'acme' }, plan, { promptTokens: -3, completionTokens: -2 }, 'error');
  assert.equal(ev.model, 'cloud');
  assert.equal(ev.resource, 'provider:cloud');
  assert.equal(ev.tokens?.total, 0);
  assert.equal(ev.project, null);
  assert.equal(ev.runId, null);
});

test('egressBlockedAuditEvent distinguishes unavailable vs leashed resource', () => {
  const unavail = egressBlockedAuditEvent(ctx, { kind: 'block', selection: null, cloudUnavailable: true, model: null, reason: '' });
  assert.equal(unavail.resource, 'provider:unavailable');
  const leashed = egressBlockedAuditEvent(ctx, { kind: 'block', selection: null, cloudUnavailable: false, model: null, reason: '' });
  assert.equal(leashed.resource, 'provider:leashed');
});

// ─── data-rtbf.resolveRtbfScope — empty subject, pii/no-pii, tags/no-tags ──────────────────────
test('resolveRtbfScope with blank subject is an empty scope', () => {
  const scope = resolveRtbfScope('   ', []);
  assert.equal(scope.subject, '');
  assert.equal(scope.targets.length, 0);
  assert.equal(scope.immediateCount, 0);
  assert.equal(scope.deferredCount, 0);
});

test('resolveRtbfScope with null-ish subject coerces to empty', () => {
  const scope = resolveRtbfScope(undefined as unknown as string, []);
  assert.equal(scope.subject, '');
});

test('resolveRtbfScope: only PII assets land in warehouse scope; tags vs no-tags detail', () => {
  const assets: RtbfAsset[] = [
    { id: 'a1', name: 'Ledger', source: 'pg', hasPii: true, piiTags: ['PAN', 'AADHAAR'] },
    { id: 'a2', name: 'Metrics', source: 'ch', hasPii: false, piiTags: [] },
    { id: 'a3', name: 'KYC', source: 's3', hasPii: true, piiTags: [] },
  ];
  const scope = resolveRtbfScope('user@x.co', assets);
  const wh = scope.targets.filter((t) => t.plane === 'warehouse');
  assert.equal(wh.length, 2, 'only the 2 PII assets');
  assert.match(wh.find((t) => t.ref === 'a1')!.detail, /holds PII \[PAN, AADHAAR\]/);
  assert.match(wh.find((t) => t.ref === 'a3')!.detail, /purge on S2\.$/);
  // vector + lineage always present (deferred), console steps immediate
  assert.ok(scope.targets.some((t) => t.plane === 'vector'));
  assert.ok(scope.targets.some((t) => t.plane === 'lineage'));
  assert.ok(scope.immediateCount >= 0);
  assert.equal(scope.deferredCount, scope.targets.length - scope.immediateCount);
});

// ─── data-retention.evaluateRetention — every state branch ─────────────────────────────────────
test('normalizeRetentionAction: valid passes, invalid/blank → delete', () => {
  assert.equal(normalizeRetentionAction('archive'), 'archive');
  assert.equal(normalizeRetentionAction('ANONYMIZE'), 'anonymize');
  assert.equal(normalizeRetentionAction('bogus'), 'delete');
  assert.equal(normalizeRetentionAction(null), 'delete');
});

test('evaluateRetention: legal hold wins over everything', () => {
  const r = evaluateRetention({ legalHold: true, retainDays: 30, anchorAt: '2020-01-01' });
  assert.equal(r.state, 'held');
  assert.equal(r.dueForDisposal, false);
});

test('evaluateRetention: no window → indefinite (0 and absent both)', () => {
  assert.equal(evaluateRetention({ retainDays: 0 }).state, 'indefinite');
  assert.equal(evaluateRetention({}).state, 'indefinite');
  assert.equal(evaluateRetention({ retainDays: -5 }).state, 'indefinite');
});

test('evaluateRetention: window set but NO anchor → unknown', () => {
  assert.equal(evaluateRetention({ retainDays: 30 }).state, 'unknown');
  assert.equal(evaluateRetention({ retainDays: 30, anchorAt: 'not-a-date' }).state, 'unknown');
});

test('evaluateRetention: active vs due by the window math', () => {
  const now = new Date('2026-02-01T00:00:00Z');
  const active = evaluateRetention({ retainDays: 30, anchorAt: '2026-01-20T00:00:00Z' }, now);
  assert.equal(active.state, 'active');
  assert.ok((active.daysRemaining ?? 0) > 0);
  const due = evaluateRetention({ retainDays: 10, anchorAt: '2026-01-01T00:00:00Z' }, now);
  assert.equal(due.state, 'due');
  assert.equal(due.dueForDisposal, true);
  assert.ok((due.daysRemaining ?? 0) <= 0);
});
