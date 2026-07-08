import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCitations, buildCopilotPrompt, type CopilotContext } from '../src/lib/copilot-context.ts';
import type { DriftView } from '../src/lib/drift-view.ts';
import type { EvalsView } from '../src/lib/evals-view.ts';
import type { AnomalyScan } from '../src/lib/anomaly.ts';

// Cover the drift / evals / anomalies citation arms in buildCitations (lines 69-107), which the
// existing test (finops + audit only) never exercised. Real objects, no mocks.

function drift(over: Partial<DriftView> = {}): DriftView {
  return {
    engine: 'evidently',
    status: 'drift',
    drifted: true,
    driftScore: 0.42,
    features: [
      { name: 'amount', drifted: true, score: 0.8, status: 'drift' },
      { name: 'age', drifted: false, score: 0.1, status: 'ok' },
    ] as DriftView['features'],
    baseline: 1000,
    current: 500,
    note: null,
    lastChecked: '2026-07-04T10:00:00.000Z',
    ...over,
  };
}

function evals(over: Partial<EvalsView> = {}): EvalsView {
  return {
    totals: { runs: 3, cases: 20, passed: 16, failed: 4, passRate: 80 },
    suites: [
      { engine: 'golden', total: 10, passed: 6, failed: 4, passRate: 60, lastRun: '2026-07-04T09:00:00Z' } as EvalsView['suites'][number],
      { engine: 'ragas', total: 10, passed: 10, failed: 0, passRate: 100, lastRun: '2026-07-03T09:00:00Z' } as EvalsView['suites'][number],
    ],
    recentRuns: [],
    goldenCases: 20,
    ...over,
  };
}

const scan: AnomalyScan = {
  method: 'mad',
  window: 7,
  threshold: 3,
  points: 14,
  anomalies: [
    { index: 13, label: '2026-07-04', value: 900, baseline: 100, deviation: 8, direction: 'up', severity: 'critical', method: 'mad' },
    { index: 12, label: '2026-07-03', value: 300, baseline: 100, deviation: 4, direction: 'up', severity: 'warning', method: 'mad' },
  ],
};

test('anomalies produce citations (both arms of the count cap loop)', () => {
  const cites = buildCitations({ question: 'q', anomalies: [{ metric: 'cost', scan }] });
  const a = cites.filter((c) => c.source === 'anomaly');
  assert.equal(a.length, 2);
  assert.match(a[0].text, /cost up on 2026-07-04/);
  assert.match(a[0].text, /critical/);
  // anomalies are numbered first
  assert.equal(cites[0].n, 1);
});

test('drift produces an overall citation plus per-drifted-feature citations', () => {
  const cites = buildCitations({ question: 'q', drift: drift() });
  const d = cites.filter((c) => c.source === 'drift');
  // 1 overall + 1 drifted feature (amount); the non-drifted "age" is skipped
  assert.equal(d.length, 2);
  assert.match(d[0].text, /Drift verdict: drift/);
  assert.match(d[0].text, /1\/2 features drifted/);
  assert.match(d[1].text, /Feature "amount" drifted/);
});

test('drift with null lastChecked and null driftScore renders the fallback arms', () => {
  const cites = buildCitations({ question: 'q', drift: drift({ lastChecked: null, driftScore: null }) });
  const overall = cites.find((c) => c.source === 'drift')!;
  assert.match(overall.text, /score n\/a/);
  assert.doesNotMatch(overall.text, /checked/);
});

test('evals with runs>0 cites totals plus failing suites (passRate<100 only)', () => {
  const cites = buildCitations({ question: 'q', evals: evals() });
  const e = cites.filter((c) => c.source === 'evals');
  // totals + the one suite under 100% (golden); the 100% suite (ragas) is skipped
  assert.equal(e.length, 2);
  assert.match(e[0].text, /80% pass across 20 cases/);
  assert.match(e[1].text, /Suite "golden"/);
});

test('evals with zero runs contributes no citation (the runs>0 guard, false arm)', () => {
  const cites = buildCitations({ question: 'q', evals: evals({ totals: { runs: 0, cases: 0, passed: 0, failed: 0, passRate: 0 } }) });
  assert.ok(!cites.some((c) => c.source === 'evals'));
});

test('buildCopilotPrompt with a fully-populated context has data and numbers every source', () => {
  const ctx: CopilotContext = {
    question: 'what is going on?',
    drift: drift(),
    evals: evals(),
    anomalies: [{ metric: 'errors', scan }],
  };
  const prompt = buildCopilotPrompt(ctx);
  assert.equal(prompt.hasData, true);
  assert.ok(prompt.citations.length > 4);
  prompt.citations.forEach((c, i) => assert.equal(c.n, i + 1));
  assert.match(prompt.user, /\[1\]/);
});
