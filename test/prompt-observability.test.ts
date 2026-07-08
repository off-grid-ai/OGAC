import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPromptAggsQuery,
  emptyPromptObservability,
  parsePromptAggsResponse,
  promptRunPrefix,
  promptRunTag,
  versionFromTag,
} from '../src/lib/prompt-observability.ts';

// PURE unit tests for the per-prompt observability rollups — no DB, no network. Mirrors
// analytics-aggs.test.ts: pin the query SHAPE (prefix filter on corrId + terms/percentiles/sum/
// date_histogram) and prove the parser reconstructs per-version metrics from an OpenSearch response.

const PID = 'p-abc';
const V1 = '2026-07-01T10:00:00.000Z';
const V2 = '2026-07-08T12:00:00.000Z';

// ─── tag encoding (the reuse seam both the emitter and the aggregator agree on) ──────────────────
test('promptRunTag / promptRunPrefix / versionFromTag round-trip', () => {
  const tag = promptRunTag(PID, V2);
  assert.equal(tag, `promptrun:${PID}@${V2}`);
  assert.ok(tag.startsWith(promptRunPrefix(PID)));
  assert.equal(versionFromTag(PID, tag), V2);
  // A corrId that isn't this prompt's tag yields '' (never mis-attributed).
  assert.equal(versionFromTag(PID, 'chatrun_1234'), '');
  assert.equal(versionFromTag(PID, promptRunTag('other', V1)), '');
});

// ─── buildPromptAggsQuery ────────────────────────────────────────────────────────────────────────
test('buildPromptAggsQuery is a size:0 search scoped to the prompt by corrId prefix', () => {
  const now = Date.parse('2026-07-09T00:00:00.000Z');
  const q = buildPromptAggsQuery(PID, now, 30) as any;
  assert.equal(q.size, 0, 'must not pull raw docs');
  const filters = q.query.bool.filter;
  // corrId.keyword prefix — the aggregatable sub-field, scoped to this prompt.
  assert.deepEqual(filters[0], { prefix: { 'corrId.keyword': `promptrun:${PID}@` } });
  // 30-day window boundary.
  const gte = filters[1].range['@timestamp'].gte;
  assert.equal(gte, new Date(now - 30 * 86_400_000).toISOString());
  // Per-version terms agg on corrId.keyword (NOT the bare text field — that 400s the search).
  assert.equal(q.aggs.by_version.terms.field, 'corrId.keyword');
  assert.deepEqual(q.aggs.latency_pct.percentiles.percents, [50, 95]);
  assert.equal(q.aggs.series.date_histogram.calendar_interval, 'day');
  // blocked filter = status >= 400.
  assert.deepEqual(q.aggs.blocked.filter, { range: { status: { gte: 400 } } });
});

test('buildPromptAggsQuery honours a custom window', () => {
  const now = Date.parse('2026-07-09T00:00:00.000Z');
  const q = buildPromptAggsQuery(PID, now, 7) as any;
  assert.equal(
    q.query.bool.filter[1].range['@timestamp'].gte,
    new Date(now - 7 * 86_400_000).toISOString(),
  );
});

// ─── parsePromptAggsResponse ──────────────────────────────────────────────────────────────────────
test('parsePromptAggsResponse rolls up overall + per-version metrics', () => {
  const resp = {
    hits: { total: { value: 30 } },
    aggregations: {
      total_tokens: { value: 12000 },
      latency_pct: { values: { '50.0': 812.4, '95.0': 2103.9 } },
      blocked: { doc_count: 3 },
      by_version: {
        buckets: [
          {
            key: promptRunTag(PID, V2),
            doc_count: 20,
            tokens: { value: 9000 },
            latency_pct: { values: { '50.0': 700, '95.0': 1800 } },
            blocked: { doc_count: 1 },
          },
          {
            key: promptRunTag(PID, V1),
            doc_count: 10,
            tokens: { value: 3000 },
            latency_pct: { values: { '50.0': 1000, '95.0': 2500 } },
            blocked: { doc_count: 2 },
          },
        ],
      },
      series: {
        buckets: [
          { key_as_string: '2026-07-08', doc_count: 12 },
          { key_as_string: '2026-07-07', doc_count: 8 },
        ],
      },
    },
  };

  const o = parsePromptAggsResponse(PID, resp, 30);
  assert.equal(o.runs, 30);
  assert.equal(o.tokens, 12000);
  assert.equal(o.p50, 812); // rounded
  assert.equal(o.p95, 2104); // rounded
  assert.equal(o.blockRate, 0.1); // 3/30
  assert.equal(o.windowDays, 30);

  // Per-version — newest version first (ISO sorts lexicographically), bare version labels.
  assert.equal(o.byVersion.length, 2);
  assert.equal(o.byVersion[0].version, V2);
  assert.equal(o.byVersion[0].runs, 20);
  assert.equal(o.byVersion[0].p50, 700);
  assert.equal(o.byVersion[0].blockRate, 0.05); // 1/20
  assert.equal(o.byVersion[1].version, V1);
  assert.equal(o.byVersion[1].blockRate, 0.2); // 2/10

  // Series sorted ascending by day.
  assert.deepEqual(
    o.series.map((s) => s.day),
    ['2026-07-07', '2026-07-08'],
  );
  assert.equal(o.series[1].runs, 12);
});

test('parsePromptAggsResponse tolerates a total as a bare number and empty aggs', () => {
  const o = parsePromptAggsResponse(PID, { hits: { total: 0 } as any, aggregations: {} });
  assert.equal(o.runs, 0);
  assert.equal(o.blockRate, 0);
  assert.deepEqual(o.byVersion, []);
  assert.deepEqual(o.series, []);
});

test('emptyPromptObservability is all real zeros', () => {
  const e = emptyPromptObservability(14);
  assert.equal(e.runs, 0);
  assert.equal(e.tokens, 0);
  assert.equal(e.p50, 0);
  assert.equal(e.p95, 0);
  assert.equal(e.blockRate, 0);
  assert.equal(e.windowDays, 14);
  assert.deepEqual(e.byVersion, []);
  assert.deepEqual(e.series, []);
});
