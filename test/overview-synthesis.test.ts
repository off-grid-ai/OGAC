import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type OperatorHomeInput,
  synthesizeOperatorHome,
} from '../src/lib/overview-synthesis.ts';

// Pure operator-home synthesizer. No network, no mocks — representative module snapshots in, the
// asserted operator-home view-model out. Covers the cross-module blocking feed (audit ∪ policy ∪
// guardrails), the 24h window, posture/cost/health tiles, deep-links, and the all-clear path.

const NOW = Date.parse('2026-07-06T12:00:00Z');
const HOUR = 3_600_000;

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

// A realistic, cross-module snapshot: traffic + spend + a denied policy decision + blocked/denied
// audit events (one stale, outside the window) + PII redactions + mixed service health.
function fullInput(): OperatorHomeInput {
  return {
    analytics: {
      totalEvents: 1240,
      totalTokens: 980_000,
      p50: 320,
      p95: 5400,
      egressRate: 0.12,
      outcomes: { ok: 1200, redacted: 34, blocked: 6 },
    },
    finops: {
      totals: { requests: 1240, tokens: 980_000, costUsd: 4.37, localShare: 92 },
      byKey: [
        { name: 'analytics-team', pct: 140, budgetUsd: 50 },
        { name: 'support-bot', pct: 30, budgetUsd: 100 },
      ],
    },
    policy: { engine: 'opa', reachable: true },
    guardrails: { engine: 'presidio', reachable: true, configured: true },
    audit: [
      {
        id: 'a1',
        ts: iso(2 * HOUR),
        actor: 'alice@corp',
        action: 'exfiltration attempt',
        outcome: 'blocked',
        detail: 'model=cloud-claude path=/v1/chat',
      },
      {
        id: 'a2',
        ts: iso(5 * HOUR),
        actor: 'svc-bot',
        action: 'unauthorized read',
        outcome: 'denied',
        detail: 'resource=secrets',
      },
      {
        id: 'a3',
        ts: iso(3 * HOUR),
        actor: 'bob@corp',
        action: 'chat',
        outcome: 'allowed',
        detail: 'ok',
      },
      // Stale — 30h ago, outside the 24h window; must be excluded.
      {
        id: 'a4',
        ts: iso(30 * HOUR),
        actor: 'old@corp',
        action: 'old block',
        outcome: 'blocked',
        detail: 'stale',
      },
    ],
    decisions: [
      { id: 'd1', allow: false, path: 'offgrid/authz', input: 'action=delete', timestamp: iso(1 * HOUR) },
      { id: 'd2', allow: true, path: 'offgrid/authz', input: 'action=read', timestamp: iso(1 * HOUR) },
    ],
    services: [
      { id: 'gateway', label: 'AI Gateway', status: 'up', ms: 42 },
      { id: 'langfuse', label: 'Langfuse', status: 'up', ms: 88 },
      { id: 'presidio', label: 'Presidio', status: 'down', ms: null },
    ],
    activity: [
      { id: 'r1', agentId: 'researcher', query: 'summarize Q2', status: 'done', startedAt: iso(HOUR) },
      { id: 'r2', agentId: 'analyst', query: 'blocked query', status: 'blocked', startedAt: iso(2 * HOUR) },
    ],
    now: NOW,
    connectors: [{ status: 'connected' }, { status: 'error' }],
  };
}

test('blocking feed unions audit + policy + guardrails within the 24h window', () => {
  const home = synthesizeOperatorHome(fullInput());
  const { blocking } = home;

  // 2 in-window audit (blocked a1 + denied a2), 1 policy deny (d1), 1 guardrails redaction rollup.
  // Stale audit a4 (30h) excluded; allowed audit a3 and allowed decision d2 excluded.
  assert.equal(blocking.total, 4);
  assert.equal(blocking.windowHours, 24);

  const sources = blocking.items.map((i) => i.source).sort();
  assert.deepEqual(sources, ['audit', 'audit', 'guardrails', 'policy']);

  // No stale record leaked in.
  assert.ok(!blocking.items.some((i) => i.id === 'audit:a4'));
  // No allowed record leaked in.
  assert.ok(!blocking.items.some((i) => i.id === 'audit:a3'));
  assert.ok(!blocking.items.some((i) => i.id === 'policy:d2'));

  // Guardrails rollup carries the redacted count and deep-links to guardrails.
  const g = blocking.items.find((i) => i.source === 'guardrails')!;
  assert.equal(g.kind, 'redacted');
  assert.match(g.title, /34 PII redactions/);
  assert.equal(g.href, '/guardrails');
});

test('blocking items are newest-first, timestamped ones before the undated rollup', () => {
  const { blocking } = synthesizeOperatorHome(fullInput());
  // Order: d1 (1h) → a1 (2h) → a2 (5h) → guardrails rollup (no ts, last).
  assert.deepEqual(
    blocking.items.map((i) => i.id),
    ['policy:d1', 'audit:a1', 'audit:a2', 'guardrails:redactions'],
  );
  assert.equal(blocking.items[blocking.items.length - 1].ts, '');
});

test('every blocking item deep-links to its source module', () => {
  const { blocking } = synthesizeOperatorHome(fullInput());
  const byId = new Map(blocking.items.map((i) => [i.id, i.href]));
  assert.equal(byId.get('audit:a1'), '/siem?outcome=blocked');
  assert.equal(byId.get('audit:a2'), '/siem?outcome=denied');
  assert.equal(byId.get('policy:d1'), '/policy');
  assert.equal(byId.get('guardrails:redactions'), '/guardrails');
});

test('posture tiles synthesize the blocking count, policy, guardrails, and egress', () => {
  const { posture } = synthesizeOperatorHome(fullInput());
  const byLabel = new Map(posture.map((t) => [t.label, t]));

  const block = byLabel.get('Blocking decisions (24h)')!;
  assert.equal(block.value, '4');
  assert.equal(block.tone, 'warn');
  assert.equal(block.href, '/control');
  assert.match(block.hint!, /1 policy · 2 audit · 1 redaction/);

  assert.equal(byLabel.get('Policy engine')!.value, 'OPA');
  assert.equal(byLabel.get('Policy engine')!.tone, 'good');

  assert.equal(byLabel.get('PII guardrails')!.value, 'PRESIDIO');
  assert.equal(byLabel.get('PII guardrails')!.tone, 'good');

  assert.equal(byLabel.get('Cloud egress')!.value, '12%');
  assert.equal(byLabel.get('Cloud egress')!.tone, 'warn');
});

test('cost tiles report spend, on-prem dividend, and over-budget keys', () => {
  const { cost } = synthesizeOperatorHome(fullInput());
  const byLabel = new Map(cost.map((t) => [t.label, t]));

  assert.equal(byLabel.get('Spend (window)')!.value, '$4.37');
  assert.equal(byLabel.get('On-prem dividend')!.value, '92%');
  assert.equal(byLabel.get('On-prem dividend')!.tone, 'good');

  const over = byLabel.get('Keys over budget')!;
  assert.equal(over.value, '1'); // analytics-team at 140%
  assert.equal(over.tone, 'bad');
  cost.forEach((t) => assert.equal(t.href, '/finops'));
});

test('health summary counts up/down and tones amber on partial outage', () => {
  const { health } = synthesizeOperatorHome(fullInput());
  assert.equal(health.up, 2);
  assert.equal(health.total, 3);
  assert.equal(health.tone, 'warn'); // 1 of 3 down
  assert.equal(health.tile.value, '2/3 up');
  assert.equal(health.tile.href, '/services');
  assert.equal(health.items.length, 3);
});

test('activity passes through untouched for the page to render', () => {
  const { activity } = synthesizeOperatorHome(fullInput());
  assert.equal(activity.length, 2);
  assert.equal(activity[0].id, 'r1');
});

test('all-clear: no blocking events → good tone and an outcome-first summary', () => {
  const input = fullInput();
  input.analytics!.outcomes.redacted = 0;
  input.analytics!.egressRate = 0;
  input.audit = input.audit.filter((e) => e.outcome === 'allowed');
  input.decisions = input.decisions.filter((d) => d.allow);
  const { posture, blocking } = synthesizeOperatorHome(input);

  assert.equal(blocking.total, 0);
  assert.match(blocking.summary, /Nothing was blocked/);
  const block = posture.find((t) => t.label === 'Blocking decisions (24h)')!;
  assert.equal(block.value, '0');
  assert.equal(block.tone, 'good');
  assert.match(block.hint!, /all clear/);
  assert.equal(posture.find((t) => t.label === 'Cloud egress')!.tone, 'good');
});

test('degrades gracefully when whole modules are unavailable (null snapshots)', () => {
  const home = synthesizeOperatorHome({
    analytics: null,
    finops: null,
    policy: null,
    guardrails: null,
    audit: [],
    decisions: [],
    services: [],
    activity: [],
    now: NOW,
  });
  // The blocking tile is always present (the lead posture signal), even with no data.
  assert.equal(home.posture.length, 1);
  assert.equal(home.posture[0].label, 'Blocking decisions (24h)');
  assert.equal(home.posture[0].value, '0');
  assert.equal(home.cost.length, 0);
  assert.equal(home.health.total, 0);
  assert.equal(home.health.tone, 'good');
  assert.equal(home.blocking.total, 0);
});

test('unreachable policy / unconfigured guardrails tone bad', () => {
  const input = fullInput();
  input.policy = { engine: 'opa', reachable: false };
  input.guardrails = { engine: 'presidio', reachable: false, configured: true };
  const { posture } = synthesizeOperatorHome(input);
  const byLabel = new Map(posture.map((t) => [t.label, t]));
  assert.equal(byLabel.get('Policy engine')!.tone, 'bad');
  assert.equal(byLabel.get('PII guardrails')!.tone, 'bad');
});

test('undated audit blocking events are kept (a producer that drops timestamps still surfaces)', () => {
  const input = fullInput();
  input.audit = [
    { id: 'x', ts: '', actor: 'z', action: 'blocked op', outcome: 'blocked', detail: 'no ts' },
  ];
  input.decisions = [];
  input.analytics!.outcomes.redacted = 0;
  const { blocking } = synthesizeOperatorHome(input);
  assert.equal(blocking.total, 1);
  assert.equal(blocking.items[0].id, 'audit:x');
});
