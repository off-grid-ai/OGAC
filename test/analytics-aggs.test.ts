import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type AnalyticsEvent,
  RECENT_MS,
  assembleAnalytics,
  buildAggsQuery,
  emptyAnalytics,
  parseAggsResponse,
} from '../src/lib/analytics-aggs.ts';

// PURE unit tests for the OpenSearch analytics rollups — no DB, no network. These replaced the old
// "pull 5000 raw docs and loop in JS" path with a single `size:0` `_search` + `aggs`. The tests
// pin the query SHAPE (terms / date_histogram / percentiles / sum / filter) and prove the parser
// reconstructs the EXACT `Analytics` output shape the page/routes/reports consume.

// ─── buildAggsQuery ────────────────────────────────────────────────────────────
test('buildAggsQuery is a size:0 aggregation search (no raw docs)', () => {
  const q = buildAggsQuery(Date.now()) as any;
  assert.equal(q.size, 0, 'must not pull raw docs');
  assert.deepEqual(q.query, { match_all: {} });
  assert.ok(q.aggs, 'has aggs');
});

test('buildAggsQuery uses the native agg types the task requires', () => {
  const q = buildAggsQuery(Date.now()) as any;
  // sum for tokens; percentiles for p50/p95; terms for byModel; date_histogram for series.
  assert.ok(q.aggs.total_tokens.sum, 'sum on tokens');
  assert.deepEqual(q.aggs.latency_pct.percentiles, { field: 'ms', percents: [50, 95] });
  assert.equal(q.aggs.by_model.terms.field, 'model.keyword');
  assert.equal(q.aggs.by_model.terms.order.tokens, 'desc');
  assert.ok(q.aggs.by_model.aggs.tokens.sum, 'per-model token sum');
  assert.ok(q.aggs.by_model.aggs.latency.sum, 'per-model latency sum');
  assert.equal(q.aggs.series.date_histogram.field, '@timestamp');
  assert.equal(q.aggs.series.date_histogram.calendar_interval, 'day');
  // outcomes blocked = filter on status >= 400
  assert.deepEqual(q.aggs.blocked.filter, { range: { status: { gte: 400 } } });
});

test('buildAggsQuery splits recent vs baseline on the 2-day boundary', () => {
  const now = 1_700_000_000_000;
  const q = buildAggsQuery(now) as any;
  const boundary = new Date(now - RECENT_MS).toISOString();
  assert.equal(q.aggs.recent.filter.range['@timestamp'].gte, boundary, 'recent is gte boundary');
  assert.equal(q.aggs.baseline.filter.range['@timestamp'].lt, boundary, 'baseline is lt boundary');
  // Each window carries its own blocked filter + latency percentiles for drift/perf signals.
  assert.ok(q.aggs.recent.aggs.blocked.filter);
  assert.ok(q.aggs.recent.aggs.latency_pct.percentiles);
  assert.ok(q.aggs.baseline.aggs.blocked.filter);
  assert.ok(q.aggs.baseline.aggs.latency_pct.percentiles);
});

// ─── parseAggsResponse ───────────────────────────────────────────────────────────
// A representative OpenSearch aggregation response: 100 total docs, 12 blocked (status>=400),
// two models, two days, with recent p95 well above baseline p95 (perf flagged) and a recent
// blocked-rate spike (drift flagged).
function sampleResponse() {
  return {
    hits: { total: { value: 100 } },
    aggregations: {
      total_tokens: { value: 54321 },
      latency_pct: { values: { '50.0': 120.4, '95.0': 880.6 } },
      blocked: { doc_count: 12 },
      by_model: {
        buckets: [
          { key: 'gpt-4o', doc_count: 60, tokens: { value: 40000 }, latency: { value: 90000 } },
          { key: 'gemma-local', doc_count: 40, tokens: { value: 14321 }, latency: { value: 20000 } },
        ],
      },
      series: {
        buckets: [
          { key_as_string: '2026-07-03', doc_count: 40, latency: { value: 20000 } },
          { key_as_string: '2026-07-04', doc_count: 60, latency: { value: 90000 } },
        ],
      },
      recent: {
        doc_count: 50,
        blocked: { doc_count: 10 },
        latency_pct: { values: { '50.0': 200, '95.0': 1500.7 } },
      },
      baseline: {
        doc_count: 50,
        blocked: { doc_count: 2 },
        latency_pct: { values: { '50.0': 100, '95.0': 400.2 } },
      },
    },
  };
}

test('parseAggsResponse reconstructs the Analytics shape (field-by-field)', () => {
  const a = parseAggsResponse(sampleResponse());

  assert.equal(a.totalEvents, 100);
  assert.equal(a.totalTokens, 54321);
  assert.equal(a.p50, 120); // Math.round(120.4)
  assert.equal(a.p95, 881); // Math.round(880.6)
  assert.equal(a.egressRate, 0); // gateway records never leftDevice — always 0

  // outcomes: ok = total - blocked; redacted always 0
  assert.deepEqual(a.outcomes, { ok: 88, redacted: 0, blocked: 12 });

  // byModel: tokens desc, avgLatency = round(latencySum/events)
  assert.deepEqual(a.byModel, [
    { model: 'gpt-4o', events: 60, tokens: 40000, avgLatency: 1500 },
    { model: 'gemma-local', events: 40, tokens: 14321, avgLatency: 500 },
  ]);

  // series: sorted by day asc, avgLatency = round(latencySum/events)
  assert.deepEqual(a.series, [
    { day: '2026-07-03', events: 40, avgLatency: 500 },
    { day: '2026-07-04', events: 60, avgLatency: 1500 },
  ]);

  // drift: recent blocked-rate 10/50=0.2, baseline 2/50=0.04, flagged (0.2 > 0.04*1.5)
  assert.deepEqual(a.drift, { recent: 0.2, baseline: 0.04, flagged: true });

  // perf: recent p95 1501 (round 1500.7) vs baseline 400, flagged (1501 > 400*1.3)
  assert.deepEqual(a.perf, { recent: 1501, baseline: 400, flagged: true });
});

test('parseAggsResponse: signals stay unflagged when within factor', () => {
  const resp = sampleResponse();
  resp.aggregations.recent.blocked.doc_count = 2; // 0.04 recent == 0.04 baseline
  resp.aggregations.recent.latency_pct.values['95.0'] = 401; // ~ baseline, under 1.3x
  const a = parseAggsResponse(resp);
  assert.equal(a.drift.flagged, false);
  assert.equal(a.perf.flagged, false);
});

test('parseAggsResponse: byModel re-sorted by tokens desc regardless of input order', () => {
  const resp = sampleResponse();
  // Feed buckets in ascending token order — parser must still emit descending.
  resp.aggregations.by_model.buckets = [
    { key: 'small', doc_count: 1, tokens: { value: 10 }, latency: { value: 100 } },
    { key: 'big', doc_count: 1, tokens: { value: 999 }, latency: { value: 100 } },
  ];
  const a = parseAggsResponse(resp);
  assert.deepEqual(
    a.byModel.map((m) => m.model),
    ['big', 'small'],
  );
});

test('parseAggsResponse handles a missing/empty aggregations block as real zeros', () => {
  const a = parseAggsResponse({ hits: { total: { value: 0 } } });
  assert.deepEqual(a, emptyAnalytics());
});

test('parseAggsResponse tolerates numeric hits.total shape', () => {
  const a = parseAggsResponse({ hits: { total: 7 } as any, aggregations: { blocked: { doc_count: 3 } } });
  assert.equal(a.totalEvents, 7);
  assert.deepEqual(a.outcomes, { ok: 4, redacted: 0, blocked: 3 });
});

test('emptyAnalytics matches the fallback shape exactly', () => {
  assert.deepEqual(emptyAnalytics(), {
    totalEvents: 0,
    totalTokens: 0,
    p50: 0,
    p95: 0,
    egressRate: 0,
    outcomes: { ok: 0, redacted: 0, blocked: 0 },
    byModel: [],
    series: [],
    drift: { recent: 0, baseline: 0, flagged: false },
    perf: { recent: 0, baseline: 0, flagged: false },
  });
});

// ─── assembleAnalytics (the #238 fix) ──────────────────────────────────────────
// The JS rollup over raw docs that feeds computeAnalytics. Unlike the OpenSearch `date_histogram`
// path it buckets the day series in JS off the record `ts` — so the per-day charts render a real
// series whenever there are events, independent of the `@timestamp` field mapping. Tests assert the
// TERMINAL Analytics shape (what the charts/cards actually receive).

// A small representative corpus spread over three UTC days — the same event set produces the stat
// cards (totals) AND the chart series, so they must AGREE. `NOW` is fixed for a deterministic
// recent/baseline split.
const NOW = Date.parse('2026-07-12T12:00:00.000Z');
function corpus(): AnalyticsEvent[] {
  return [
    // day 1 (baseline — > 2 days old)
    { ts: '2026-07-08T09:00:00.000Z', model: 'gpt-4o', tokens: 1000, latencyMs: 200, outcome: 'ok' },
    { ts: '2026-07-08T10:00:00.000Z', model: 'gemma-local', tokens: 500, latencyMs: 100, outcome: 'ok' },
    // day 2 (baseline)
    { ts: '2026-07-09T11:00:00.000Z', model: 'gpt-4o', tokens: 2000, latencyMs: 400, outcome: 'ok' },
    // day 3 (recent — < 2 days old), including one blocked
    { ts: '2026-07-11T13:00:00.000Z', model: 'gpt-4o', tokens: 3000, latencyMs: 900, outcome: 'ok' },
    { ts: '2026-07-11T14:00:00.000Z', model: 'gemma-local', tokens: 800, latencyMs: 150, outcome: 'blocked' },
  ];
}

// THE REGRESSION GUARD (#238): the charts must NOT be flat while the cards have data. A populated
// corpus must yield a non-empty `series` whose event count equals `totalEvents` — the exact invariant
// the old date_histogram path violated (cards non-zero, series []).
test('assembleAnalytics: series is non-empty and its events sum to totalEvents (charts bind to the cards)', () => {
  const a = assembleAnalytics(corpus(), NOW);
  assert.ok(a.totalEvents > 0, 'precondition: cards have data');
  assert.ok(a.series.length > 0, 'series must not be flat when there are events (#238)');
  const seriesEvents = a.series.reduce((sum, d) => sum + d.events, 0);
  assert.equal(seriesEvents, a.totalEvents, 'series event total must equal the card total');
  // byModel (the Tokens-by-model chart) must likewise bind and its tokens sum to the card total.
  const byModelTokens = a.byModel.reduce((sum, m) => sum + m.tokens, 0);
  assert.equal(byModelTokens, a.totalTokens, 'byModel tokens must equal the card total');
});

test('assembleAnalytics: buckets one point per UTC day, sorted asc, avg latency rounded', () => {
  const a = assembleAnalytics(corpus(), NOW);
  assert.deepEqual(
    a.series.map((d) => d.day),
    ['2026-07-08', '2026-07-09', '2026-07-11'],
    'one point per calendar day, ascending',
  );
  // 2026-07-08: two events, latency 200 + 100 → avg round(300/2)=150.
  assert.deepEqual(a.series[0], { day: '2026-07-08', events: 2, avgLatency: 150 });
  // 2026-07-11: two events (one blocked still counts as an event), latency 900+150 → round(1050/2)=525.
  assert.deepEqual(a.series[2], { day: '2026-07-11', events: 2, avgLatency: 525 });
});

test('assembleAnalytics: totals, outcomes, byModel match the raw corpus', () => {
  const a = assembleAnalytics(corpus(), NOW);
  assert.equal(a.totalEvents, 5);
  assert.equal(a.totalTokens, 1000 + 500 + 2000 + 3000 + 800);
  assert.deepEqual(a.outcomes, { ok: 4, redacted: 0, blocked: 1 });
  // byModel sorted tokens desc: gpt-4o (6000) before gemma-local (1300).
  assert.deepEqual(
    a.byModel.map((m) => m.model),
    ['gpt-4o', 'gemma-local'],
  );
  assert.equal(a.byModel[0].tokens, 6000);
  assert.equal(a.byModel[0].events, 3);
});

test('assembleAnalytics: drift & perf split on the 2-day recent/baseline boundary', () => {
  const a = assembleAnalytics(corpus(), NOW);
  // recent = 2 events (2026-07-11), 1 blocked → rate 0.5; baseline = 3 events, 0 blocked → 0.
  assert.equal(a.drift.recent, 0.5);
  assert.equal(a.drift.baseline, 0);
  assert.equal(a.drift.flagged, true, '0.5 > 0 * 1.5');
  // recent p95 over [900,150] = 900; baseline p95 over [200,100,400] = 400 → flagged (900 > 400*1.3).
  assert.equal(a.perf.recent, 900);
  assert.equal(a.perf.baseline, 400);
  assert.equal(a.perf.flagged, true);
});

test('assembleAnalytics: an empty corpus is real zeros (matches emptyAnalytics)', () => {
  assert.deepEqual(assembleAnalytics([], NOW), emptyAnalytics());
});

test('assembleAnalytics: a missing latencyMs is treated as 0 (no NaN)', () => {
  const a = assembleAnalytics(
    [{ ts: '2026-07-11T13:00:00.000Z', model: 'm', tokens: 10, outcome: 'ok' }],
    NOW,
  );
  assert.equal(a.series[0].avgLatency, 0);
  assert.equal(a.byModel[0].avgLatency, 0);
  assert.equal(a.p95, 0);
});
