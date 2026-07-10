import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEMO_TELEMETRY_ORGS,
  buildBulkBody,
  docId,
  runMetricToGatewayDoc,
} from '../src/lib/demo/opensearch-telemetry.ts';
import { buildRunCorpus } from '../src/lib/demo/telemetry.ts';
import { BHARAT_PROFILE, SURAKSHA_PROFILE } from '../src/lib/tour-demo-seed.ts';
import type { RunMetric } from '../src/lib/demo/telemetry.ts';

// PURE unit tests for the OpenSearch telemetry MAPPER — no network. They assert the TERMINAL doc
// shape the analytics readers aggregate on (field names verified against analytics-aggs.ts:48–82 and
// gateway-aggregator.mjs:232), the ok/blocked → 200/403 status mapping the blocked-rate filter needs,
// the tenant `org` isolation tag, and idempotency (deterministic _id ⇒ a re-run upserts, never dups).

const NOW = Date.parse('2026-07-10T00:00:00.000Z');

// A hand-built RunMetric so the field-mapping assertions don't depend on the PRNG. Uses the real
// RunMetric interface (with the `totalTokens` getter) so we exercise the true shape.
function metric(over: Partial<RunMetric> = {}): RunMetric {
  return {
    id: 'run_abc123',
    appKey: 'kyc-rekyc',
    appTitle: 'KYC & Re-KYC Verification',
    status: 'done',
    outcome: 'ok',
    model: 'qwen2.5:14b',
    promptTokens: 500,
    completionTokens: 200,
    get totalTokens() {
      return this.promptTokens + this.completionTokens;
    },
    latencyMs: 1234,
    costUsd: 0.0012,
    guardrailVerdict: 'pass',
    evalScore: 91,
    ts: '2026-07-01T12:00:00.000Z',
    ...over,
  };
}

// ─── field shape the readers aggregate on ──────────────────────────────────────
test('runMetricToGatewayDoc mirrors the analytics reader field names exactly', () => {
  const d = runMetricToGatewayDoc('org_bharat', metric());
  // @timestamp drives the day-histogram + drift/perf split; ts is the per-doc fallback.
  assert.equal(d['@timestamp'], '2026-07-01T12:00:00.000Z');
  assert.equal(d.ts, Date.parse('2026-07-01T12:00:00.000Z'));
  // tokens (sum agg) uses the corpus total, split preserved.
  assert.equal(d.tokens, 700);
  assert.equal(d.promptTokens, 500);
  assert.equal(d.completionTokens, 200);
  // ms is the latency percentile/sum field.
  assert.equal(d.ms, 1234);
  // model + model.keyword byModel terms; gateway = byGateway attribution.
  assert.equal(d.model, 'qwen2.5:14b');
  assert.equal(d.gateway, 'qwen2.5:14b');
  // project = pipeline/use-case attribution (project.keyword narrowing).
  assert.equal(d.project, 'KYC & Re-KYC Verification');
  assert.equal(d.kind, 'text');
  assert.equal(d.bytes, 0);
  // envelope parity with the aggregator write path.
  assert.equal(d.source, 'demo-seed');
});

test('an ok run maps to status 200; a blocked run maps to 403 (>=400 blocked-rate filter)', () => {
  assert.equal(runMetricToGatewayDoc('org_bharat', metric({ outcome: 'ok' })).status, 200);
  const blocked = runMetricToGatewayDoc(
    'org_suraksha',
    metric({ outcome: 'blocked', guardrailVerdict: 'blocked' }),
  );
  assert.equal(blocked.status, 403);
  assert.ok(blocked.status >= 400, 'blocked runs must be countable by the >=400 range filter');
});

test('the doc carries the tenant org isolation tag and org-scoped caller', () => {
  const b = runMetricToGatewayDoc('org_bharat', metric());
  assert.equal(b.org, 'org_bharat');
  assert.equal(b.caller, 'org_bharat:kyc-rekyc');
  const s = runMetricToGatewayDoc('org_suraksha', metric());
  assert.equal(s.org, 'org_suraksha');
  assert.equal(s.caller, 'org_suraksha:kyc-rekyc');
});

test('extra demo fields (cost/eval/verdict/outcome/appKey) ride along', () => {
  const d = runMetricToGatewayDoc('org_bharat', metric({ costUsd: 0.5, evalScore: 88 }));
  assert.equal(d.costUsd, 0.5);
  assert.equal(d.evalScore, 88);
  assert.equal(d.guardrailVerdict, 'pass');
  assert.equal(d.outcome, 'ok');
  assert.equal(d.appKey, 'kyc-rekyc');
});

// ─── idempotency: deterministic id ⇒ upsert, never duplicate ────────────────────
test('docId is the run id and corrId matches it (a doc traces back to its run)', () => {
  const m = metric({ id: 'run_deadbeef' });
  assert.equal(docId(m), 'run_deadbeef');
  assert.equal(runMetricToGatewayDoc('org_bharat', m).corrId, 'run_deadbeef');
});

// ─── bulk body ──────────────────────────────────────────────────────────────────
test('buildBulkBody emits index actions with explicit _id and trailing newline', () => {
  const corpus = [metric({ id: 'run_1' }), metric({ id: 'run_2', outcome: 'blocked' })];
  const body = buildBulkBody('offgrid-gateway', 'org_bharat', corpus);
  assert.ok(body.endsWith('\n'), 'a bulk body must end with a newline');
  const lines = body.trimEnd().split('\n');
  assert.equal(lines.length, 4, 'two docs ⇒ two action lines + two source lines');
  const action1 = JSON.parse(lines[0]);
  assert.deepEqual(action1, { index: { _index: 'offgrid-gateway', _id: 'run_1' } });
  const source2 = JSON.parse(lines[3]);
  assert.equal(source2.status, 403);
  assert.equal(source2.org, 'org_bharat');
});

test('buildBulkBody on an empty corpus is the empty string (no stray newline)', () => {
  assert.equal(buildBulkBody('offgrid-gateway', 'org_bharat', []), '');
});

test('buildBulkBody is idempotent — same corpus ⇒ byte-identical body ⇒ re-run upserts', () => {
  const corpus = buildRunCorpus(BHARAT_PROFILE, NOW);
  const a = buildBulkBody('offgrid-gateway', 'org_bharat', corpus);
  const b = buildBulkBody('offgrid-gateway', 'org_bharat', buildRunCorpus(BHARAT_PROFILE, NOW));
  assert.equal(a, b);
  // Every action line carries a stable _id ⇒ a bulk re-run overwrites, never appends.
  const ids = a
    .trimEnd()
    .split('\n')
    .filter((_l, i) => i % 2 === 0)
    .map((l) => JSON.parse(l).index._id);
  assert.equal(new Set(ids).size, ids.length, 'every doc _id is unique within the corpus');
});

// ─── org isolation over the REAL corpus ─────────────────────────────────────────
test('every doc built from a tenant corpus is tagged with ONLY that tenant org', () => {
  const bank = buildRunCorpus(BHARAT_PROFILE, NOW).map((m) => runMetricToGatewayDoc('org_bharat', m));
  const insurer = buildRunCorpus(SURAKSHA_PROFILE, NOW).map((m) =>
    runMetricToGatewayDoc('org_suraksha', m),
  );
  assert.ok(bank.length > 0 && insurer.length > 0);
  assert.ok(bank.every((d) => d.org === 'org_bharat'));
  assert.ok(insurer.every((d) => d.org === 'org_suraksha'));
  // The two tenants never share a doc id (no cross-tenant collision on upsert).
  const bankIds = new Set(bank.map((d) => d.corrId));
  assert.ok(insurer.every((d) => !bankIds.has(d.corrId)));
});

test('the allow-list is exactly the two demo tenants', () => {
  assert.deepEqual([...DEMO_TELEMETRY_ORGS], ['org_bharat', 'org_suraksha']);
});
