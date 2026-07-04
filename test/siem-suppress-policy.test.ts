import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applySuppressions,
  isSuppressed,
  validateSuppression,
} from '../src/lib/siem-suppress-policy.ts';
import type { SuppressionRule } from '../src/lib/siem-suppress-policy.ts';
import type { SiemEvent, SiemView } from '../src/lib/siem-view.ts';

// PURE unit tests — no DB, no network. Exercises the suppression validation gate and the
// apply/re-aggregate logic that keeps the SIEM view internally consistent after muting.

function ev(over: Partial<SiemEvent>): SiemEvent {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    ts: over.ts ?? '2026-07-04T00:00:00Z',
    actor: over.actor ?? 'alice',
    action: over.action ?? 'POST /v1/chat',
    outcome: over.outcome ?? 'allowed',
    ip: over.ip ?? '10.0.0.1',
    detail: over.detail ?? '',
  };
}

function rule(over: Partial<SuppressionRule>): SuppressionRule {
  return {
    id: over.id ?? 'sup_x',
    kind: over.kind ?? 'actor',
    pattern: over.pattern ?? 'alice',
    note: over.note ?? '',
    createdAt: over.createdAt ?? '',
  };
}

test('validateSuppression rejects bad input', () => {
  assert.equal(validateSuppression(null).ok, false);
  assert.equal(validateSuppression({ kind: 'nope' as never, pattern: 'x' }).ok, false);
  assert.equal(validateSuppression({ kind: 'ip', pattern: '' }).ok, false);
  assert.equal(validateSuppression({ kind: 'ip', pattern: '  ' }).ok, false, 'whitespace-only fails');
  assert.equal(validateSuppression({ kind: 'action', pattern: 'x'.repeat(201) }).ok, false, 'too long');
});

test('validateSuppression accepts + trims valid input', () => {
  const v = validateSuppression({ kind: 'actor', pattern: '  svc-health  ', note: '  noisy  ' });
  assert.equal(v.ok, true);
  assert.equal(v.value!.pattern, 'svc-health', 'pattern trimmed');
  assert.equal(v.value!.note, 'noisy', 'note trimmed');
});

test('isSuppressed matches case-insensitive substring on the right field', () => {
  const e = ev({ actor: 'svc-HealthCheck', ip: '10.0.0.5', action: 'GET /healthz' });
  assert.equal(isSuppressed(e, [rule({ kind: 'actor', pattern: 'healthcheck' })]), true);
  assert.equal(isSuppressed(e, [rule({ kind: 'ip', pattern: '10.0.0.5' })]), true);
  assert.equal(isSuppressed(e, [rule({ kind: 'action', pattern: '/healthz' })]), true);
  // wrong field does not match
  assert.equal(isSuppressed(e, [rule({ kind: 'actor', pattern: '10.0.0.5' })]), false);
  // empty rule set never suppresses
  assert.equal(isSuppressed(e, []), false);
});

test('applySuppressions drops events AND re-derives every aggregate', () => {
  const events = [
    ev({ id: '1', actor: 'alice', outcome: 'allowed' }),
    ev({ id: '2', actor: 'svc-health', outcome: 'allowed' }),
    ev({ id: '3', actor: 'svc-health', outcome: 'blocked' }),
    ev({ id: '4', actor: 'bob', outcome: 'denied' }),
  ];
  const view: SiemView = {
    total: 4,
    events,
    byOutcome: [
      { outcome: 'allowed', count: 2 },
      { outcome: 'blocked', count: 1 },
      { outcome: 'denied', count: 1 },
    ],
    topActors: [
      { actor: 'svc-health', count: 2 },
      { actor: 'alice', count: 1 },
      { actor: 'bob', count: 1 },
    ],
    blockedDenied: 2,
  };

  const out = applySuppressions(view, [rule({ kind: 'actor', pattern: 'svc-health' })]);
  assert.equal(out.total, 2, 'two svc-health events dropped');
  assert.deepEqual(
    out.events.map((e) => e.id),
    ['1', '4'],
  );
  // blockedDenied recomputed: only bob's 'denied' survives (svc-health 'blocked' was dropped)
  assert.equal(out.blockedDenied, 1);
  // outcome facets recomputed
  assert.equal(out.byOutcome.find((o) => o.outcome === 'blocked'), undefined, 'blocked facet gone');
  assert.equal(out.byOutcome.find((o) => o.outcome === 'allowed')!.count, 1);
  // top actors recomputed — svc-health gone
  assert.equal(out.topActors.find((a) => a.actor === 'svc-health'), undefined);
});

test('applySuppressions with no rules returns the view unchanged', () => {
  const view: SiemView = { total: 1, events: [ev({ id: '1' })], byOutcome: [], topActors: [], blockedDenied: 0 };
  assert.equal(applySuppressions(view, []), view, 'same reference when no rules');
});
