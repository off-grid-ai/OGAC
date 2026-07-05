import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activityContentType,
  activityFilename,
  activityToCsv,
  activityToJson,
  activityToMarkdown,
  buildComplianceActivity,
  parseActivityFormat,
  serializeActivity,
  type ActivityRow,
} from '../src/lib/compliance-activity.ts';

// PURE unit tests for the DPO / Regulatory compliance-activity report builder — no DB, no network.
// They pin the aggregation ("who did what / what was blocked / cost") and the CSV/JSON/Markdown
// serializers over plain in-memory ledger rows. Real functions, no mocks.

const rows: ActivityRow[] = [
  {
    ts: '2026-07-01T10:00:00.000Z',
    actorType: 'user',
    actorId: 'mac@wednesday.is',
    actorLabel: 'Mac',
    org: 'default',
    project: 'finance',
    action: 'chat.send',
    model: 'gemma-local',
    totalTokens: 100,
    costUsd: 0,
    outcome: 'ok',
    runId: 'run_a',
  },
  {
    ts: '2026-07-02T10:00:00.000Z',
    actorType: 'user',
    actorId: 'mac@wednesday.is',
    actorLabel: 'Mac',
    action: 'agent.run',
    model: 'cloud-claude',
    totalTokens: 2000,
    costUsd: 0.018,
    outcome: 'ok',
    runId: 'run_b',
  },
  {
    ts: '2026-07-03T10:00:00.000Z',
    actorType: 'machine',
    actorId: 'svc-ingest',
    action: 'agent.run',
    model: 'cloud-claude',
    totalTokens: 500,
    costUsd: 0.005,
    outcome: 'blocked',
    runId: 'run_c',
  },
  {
    ts: '2026-07-04T10:00:00.000Z',
    actorType: 'user',
    actorId: 'eve@wednesday.is',
    action: 'chat.send',
    model: 'gemma-local',
    totalTokens: 50,
    outcome: 'redacted',
    runId: 'run_d',
  },
  {
    ts: '2026-07-05T10:00:00.000Z',
    actorType: 'user',
    actorId: 'eve@wednesday.is',
    action: 'budget.deny',
    outcome: 'denied',
    runId: 'run_e',
  },
];

const coverage = { runs: 4, signed: 3 };
const q = { from: '2026-07-01', to: '2026-07-05', org: 'default' };

test('buildComplianceActivity: totals sum events, cost, tokens, distinct actors', () => {
  const a = buildComplianceActivity(rows, coverage, q, '2026-07-06T00:00:00.000Z');
  assert.equal(a.totals.events, 5);
  assert.equal(a.totals.actors, 3, 'Mac, svc-ingest, eve');
  assert.equal(a.totals.tokens, 2650);
  assert.equal(a.totals.costUsd, 0.023);
  assert.equal(a.from, '2026-07-01');
  assert.equal(a.to, '2026-07-05');
  assert.equal(a.org, 'default');
});

test('buildComplianceActivity: outcome breakdown + enforcement count', () => {
  const a = buildComplianceActivity(rows, coverage, q);
  assert.equal(a.outcomes.ok, 2);
  assert.equal(a.outcomes.blocked, 1);
  assert.equal(a.outcomes.redacted, 1);
  assert.equal(a.outcomes.denied, 1);
  assert.equal(a.outcomes.error, 0);
  // blocked + denied + error = enforcement actions
  assert.equal(a.totals.blockedOrDenied, 2);
  assert.equal(a.totals.redacted, 1);
});

test('buildComplianceActivity: blockedEvents lists ONLY enforcement actions, newest-first', () => {
  const a = buildComplianceActivity(rows, coverage, q);
  assert.equal(a.blockedEvents.length, 2, 'the blocked run + the budget deny (not redacted/ok)');
  assert.equal(a.blockedEvents[0].outcome, 'denied', 'newest first: 07-05 budget.deny');
  assert.equal(a.blockedEvents[0].action, 'budget.deny');
  assert.equal(a.blockedEvents[1].outcome, 'blocked');
  assert.equal(a.blockedEvents[1].runId, 'run_c');
});

test('buildComplianceActivity: byActor rolls up events/blocked/cost per actor, desc by events', () => {
  const a = buildComplianceActivity(rows, coverage, q);
  const mac = a.byActor.find((r) => r.key === 'Mac')!;
  assert.equal(mac.events, 2);
  assert.equal(mac.blocked, 0);
  assert.equal(mac.costUsd, 0.018);
  const eve = a.byActor.find((r) => r.key === 'eve@wednesday.is')!;
  assert.equal(eve.events, 2);
  assert.equal(eve.blocked, 1, 'the budget deny');
  // descending by events — the two 2-event actors sort before the 1-event machine
  assert.ok(a.byActor[a.byActor.length - 1].key === 'svc-ingest');
});

test('buildComplianceActivity: byModel rolls up cost, desc by cost, (none) for missing model', () => {
  const a = buildComplianceActivity(rows, coverage, q);
  assert.equal(a.byModel[0].key, 'cloud-claude', 'highest cost first');
  assert.equal(a.byModel[0].costUsd, 0.023);
  assert.ok(a.byModel.some((r) => r.key === '(none)'), 'budget.deny has no model');
});

test('buildComplianceActivity: provenance coverage percent, signed clamped to runs', () => {
  const a = buildComplianceActivity(rows, coverage, q);
  assert.equal(a.provenance.runs, 4);
  assert.equal(a.provenance.signed, 3);
  assert.equal(a.provenance.coveragePct, 75);

  const zero = buildComplianceActivity(rows, { runs: 0, signed: 0 }, q);
  assert.equal(zero.provenance.coveragePct, 0, 'no divide-by-zero');

  const over = buildComplianceActivity(rows, { runs: 2, signed: 9 }, q);
  assert.equal(over.provenance.signed, 2, 'signed can never exceed runs');
  assert.equal(over.provenance.coveragePct, 100);
});

test('empty ledger yields a coherent zeroed report', () => {
  const a = buildComplianceActivity([], { runs: 0, signed: 0 }, q);
  assert.equal(a.totals.events, 0);
  assert.equal(a.totals.actors, 0);
  assert.equal(a.blockedEvents.length, 0);
  assert.deepEqual(a.byActor, []);
});

test('parseActivityFormat + content types + filenames', () => {
  assert.equal(parseActivityFormat('csv'), 'csv');
  assert.equal(parseActivityFormat('MD'), 'md');
  assert.equal(parseActivityFormat('markdown'), 'md');
  assert.equal(parseActivityFormat(null), 'json');
  assert.equal(parseActivityFormat('bogus'), 'json');
  assert.match(activityContentType('csv'), /text\/csv/);
  assert.match(activityContentType('md'), /text\/markdown/);
  assert.match(activityContentType('json'), /application\/json/);
});

test('activityToCsv: header + one row per enforcement event, RFC-quoted', () => {
  const a = buildComplianceActivity(rows, coverage, q);
  const csv = activityToCsv(a);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'time,actor,action,outcome,project,model,resource,run_id');
  assert.equal(lines.length, 3, 'header + 2 enforcement rows');
  assert.ok(lines[1].includes('budget.deny'));
});

test('activityToCsv: quotes cells containing commas', () => {
  const withComma: ActivityRow[] = [
    { ts: '2026-07-01T00:00:00.000Z', actorId: 'a,b', action: 'agent.run', outcome: 'blocked', runId: 'r1' },
  ];
  const a = buildComplianceActivity(withComma, { runs: 0, signed: 0 }, q);
  const csv = activityToCsv(a);
  assert.ok(csv.includes('"a,b"'), 'comma actor is quoted');
});

test('activityToJson: round-trips the report shape', () => {
  const a = buildComplianceActivity(rows, coverage, q);
  const parsed = JSON.parse(activityToJson(a));
  assert.equal(parsed.totals.events, 5);
  assert.equal(parsed.provenance.coveragePct, 75);
  assert.equal(parsed.blockedEvents.length, 2);
});

test('activityToMarkdown: has DPIA heading, summary, provenance line, enforcement table', () => {
  const a = buildComplianceActivity(rows, coverage, q);
  const md = activityToMarkdown(a);
  assert.match(md, /# Off Grid — Data Processing Activity Report \(DPIA\)/);
  assert.match(md, /Governed events: \*\*5\*\*/);
  assert.match(md, /Provenance coverage: \*\*75%\*\* \(3\/4/);
  assert.match(md, /## Enforcement — blocked & denied actions/);
  assert.match(md, /budget\.deny/);
});

test('activityToMarkdown: no-enforcement window states it explicitly', () => {
  const a = buildComplianceActivity(
    [{ ts: '2026-07-01T00:00:00.000Z', actorId: 'x', action: 'chat.send', outcome: 'ok' }],
    { runs: 1, signed: 1 },
    q,
  );
  assert.match(activityToMarkdown(a), /_No blocked or denied actions in this window\._/);
});

test('serializeActivity dispatches by format; filename carries the range end + ext', () => {
  const a = buildComplianceActivity(rows, coverage, q);
  assert.equal(serializeActivity(a, 'csv'), activityToCsv(a));
  assert.equal(serializeActivity(a, 'md'), activityToMarkdown(a));
  assert.equal(serializeActivity(a, 'json'), activityToJson(a));
  assert.equal(activityFilename(a, 'csv'), 'offgrid-dpia-activity-2026-07-05.csv');
  assert.equal(activityFilename(a, 'md'), 'offgrid-dpia-activity-2026-07-05.md');
});
