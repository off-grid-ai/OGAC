import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RECENT_MS,
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
