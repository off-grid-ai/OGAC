import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  UNATTRIBUTED,
  buildAccountingQuery,
  emptyAccounting,
  isRangePreset,
  parseAccountingResponse,
  resolveRange,
} from '../src/lib/accounting-aggs.ts';

// PURE unit tests for the OpenSearch usage-&-spend accounting rollups — no DB, no network. They pin
// the query SHAPE (terms on actor/project/model, each with sum on tokens, plus a nested per-model
// sub-terms for correct pricing) and prove the parser reconstructs the `Accounting` breakdown with
// spend priced via the SAME finops per-model rates the FinOps page uses. Real functions, no mocks.

// ─── buildAccountingQuery ──────────────────────────────────────────────────────
test('buildAccountingQuery is a size:0 aggregation search (no raw docs)', () => {
  const q = buildAccountingQuery() as any;
  assert.equal(q.size, 0, 'must not pull raw docs');
  assert.deepEqual(q.query, { match_all: {} }, 'no bounds → match_all');
  assert.ok(q.aggs, 'has aggs');
});

test('buildAccountingQuery aggregates on actor, project, and model with token sums', () => {
  const q = buildAccountingQuery() as any;
  // actor + project terms, each with total token sum and a nested per-model split.
  assert.equal(q.aggs.by_actor.terms.field, 'caller.keyword', 'actor = caller.keyword');
  assert.equal(q.aggs.by_project.terms.field, 'project.keyword', 'project = project.keyword');
  assert.equal(q.aggs.by_model.terms.field, 'model.keyword', 'model = model.keyword');

  // sum on tokens (prompt/completion/total) per group.
  assert.ok(q.aggs.by_actor.aggs.tokens.sum, 'actor token sum');
  assert.ok(q.aggs.by_actor.aggs.prompt_tokens.sum, 'actor prompt sum');
  assert.ok(q.aggs.by_actor.aggs.completion_tokens.sum, 'actor completion sum');
  assert.equal(q.aggs.by_actor.aggs.by_model.terms.field, 'model.keyword', 'actor→per-model split');

  assert.ok(q.aggs.by_project.aggs.tokens.sum, 'project token sum');
  assert.equal(q.aggs.by_project.aggs.by_model.terms.field, 'model.keyword', 'project→per-model split');

  // org-wide token sums + top-level per-model sum.
  assert.ok(q.aggs.org_tokens.sum, 'org token sum');
  assert.ok(q.aggs.by_model.aggs.model_tokens.sum, 'top-level per-model token sum');
});

test('buildAccountingQuery folds missing actor/project into an explicit unattributed bucket', () => {
  const q = buildAccountingQuery() as any;
  assert.equal(q.aggs.by_actor.terms.missing, UNATTRIBUTED);
  assert.equal(q.aggs.by_project.terms.missing, UNATTRIBUTED);
});

test('buildAccountingQuery applies a time-range filter when bounds are given', () => {
  const q = buildAccountingQuery('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z') as any;
  assert.deepEqual(q.query, {
    range: {
      '@timestamp': { gte: '2026-01-01T00:00:00.000Z', lte: '2026-02-01T00:00:00.000Z' },
    },
  });
  // an open-ended (from-only) range keeps just the lower bound.
  const openEnded = buildAccountingQuery('2026-01-01T00:00:00.000Z') as any;
  assert.deepEqual(openEnded.query, { range: { '@timestamp': { gte: '2026-01-01T00:00:00.000Z' } } });
});

// ─── parseAccountingResponse ─────────────────────────────────────────────────────
// A representative response: 100 docs. Two models: gpt-4o (0.005/1K) and gemma-local ($0). Two
// users (alice, bob) and one project (billing), each with their own per-model split.
function sampleResponse() {
  return {
    hits: { total: { value: 100 } },
    aggregations: {
      org_tokens: { value: 60000 },
      org_prompt_tokens: { value: 40000 },
      org_completion_tokens: { value: 20000 },
      by_model: {
        buckets: [
          { key: 'gpt-4o', doc_count: 60, model_tokens: { value: 40000 }, prompt_tokens: { value: 26000 }, completion_tokens: { value: 14000 } },
          { key: 'gemma-local', doc_count: 40, model_tokens: { value: 20000 }, prompt_tokens: { value: 14000 }, completion_tokens: { value: 6000 } },
        ],
      },
      by_actor: {
        buckets: [
          {
            key: 'alice',
            doc_count: 70,
            tokens: { value: 45000 },
            prompt_tokens: { value: 30000 },
            completion_tokens: { value: 15000 },
            by_model: {
              buckets: [
                { key: 'gpt-4o', doc_count: 40, model_tokens: { value: 30000 } },
                { key: 'gemma-local', doc_count: 30, model_tokens: { value: 15000 } },
              ],
            },
          },
          {
            key: 'bob',
            doc_count: 30,
            tokens: { value: 15000 },
            prompt_tokens: { value: 10000 },
            completion_tokens: { value: 5000 },
            by_model: {
              buckets: [
                { key: 'gpt-4o', doc_count: 20, model_tokens: { value: 10000 } },
                { key: 'gemma-local', doc_count: 10, model_tokens: { value: 5000 } },
              ],
            },
          },
        ],
      },
      by_project: {
        buckets: [
          {
            key: 'billing',
            doc_count: 100,
            tokens: { value: 60000 },
            prompt_tokens: { value: 40000 },
            completion_tokens: { value: 20000 },
            by_model: {
              buckets: [
                { key: 'gpt-4o', doc_count: 60, model_tokens: { value: 40000 } },
                { key: 'gemma-local', doc_count: 40, model_tokens: { value: 20000 } },
              ],
            },
          },
        ],
      },
    },
  };
}

test('parseAccountingResponse: org totals + per-model spend priced via finops rates', () => {
  const a = parseAccountingResponse(sampleResponse());

  assert.equal(a.totals.requests, 100);
  assert.equal(a.totals.tokens, 60000);
  assert.equal(a.totals.promptTokens, 40000);
  assert.equal(a.totals.completionTokens, 20000);
  // gpt-4o: 40000/1000 * 0.005 = 0.2 ; gemma-local: 0. Org spend = 0.2.
  assert.equal(a.totals.costUsd, 0.2);

  assert.deepEqual(a.byModel, [
    { model: 'gpt-4o', requests: 60, promptTokens: 26000, completionTokens: 14000, tokens: 40000, costUsd: 0.2 },
    { model: 'gemma-local', requests: 40, promptTokens: 14000, completionTokens: 6000, tokens: 20000, costUsd: 0 },
  ]);
});

test('parseAccountingResponse: per-user spend = sum of that user’s per-model spend', () => {
  const a = parseAccountingResponse(sampleResponse());

  // alice: gpt-4o 30000 tok → 0.15 ; gemma-local 0 → total 0.15. bob: gpt-4o 10000 → 0.05.
  const alice = a.byActor.find((u) => u.label === 'alice')!;
  const bob = a.byActor.find((u) => u.label === 'bob')!;
  assert.equal(alice.costUsd, 0.15);
  assert.equal(alice.tokens, 45000);
  assert.equal(alice.requests, 70);
  assert.equal(bob.costUsd, 0.05);

  // ranked by spend desc — alice before bob.
  assert.deepEqual(a.byActor.map((u) => u.label), ['alice', 'bob']);
  // the per-model split is carried through, priced, and sorted by cost.
  assert.deepEqual(alice.byModel.map((m) => m.model), ['gpt-4o', 'gemma-local']);
  assert.equal(alice.byModel[0].costUsd, 0.15);
  assert.equal(alice.byModel[1].costUsd, 0);
});

test('parseAccountingResponse: per-project spend priced from its per-model split', () => {
  const a = parseAccountingResponse(sampleResponse());
  const billing = a.byProject.find((p) => p.label === 'billing')!;
  // gpt-4o 40000 → 0.2, gemma-local 0 → total 0.2.
  assert.equal(billing.costUsd, 0.2);
  assert.equal(billing.tokens, 60000);
  assert.equal(billing.requests, 100);
});

test('parseAccountingResponse: local-only actor costs $0 (on-device dividend visible)', () => {
  const resp = sampleResponse();
  resp.aggregations.by_actor.buckets = [
    {
      key: 'carol',
      doc_count: 5,
      tokens: { value: 99999 },
      prompt_tokens: { value: 50000 },
      completion_tokens: { value: 49999 },
      by_model: { buckets: [{ key: 'gemma-local', doc_count: 5, model_tokens: { value: 99999 } }] },
    },
  ];
  const a = parseAccountingResponse(resp);
  const carol = a.byActor.find((u) => u.label === 'carol')!;
  assert.equal(carol.costUsd, 0, 'all-local usage is free');
  assert.equal(carol.tokens, 99999, 'tokens still counted');
});

test('parseAccountingResponse: carries the range and tolerates numeric hits.total', () => {
  const a = parseAccountingResponse(
    { hits: { total: 7 } as any, aggregations: { org_tokens: { value: 10 } } },
    { from: '2026-01-01T00:00:00.000Z', to: null },
  );
  assert.equal(a.totals.requests, 7);
  assert.equal(a.totals.tokens, 10);
  assert.deepEqual(a.range, { from: '2026-01-01T00:00:00.000Z', to: null });
});

test('parseAccountingResponse: empty/missing aggregations → real zeros', () => {
  const a = parseAccountingResponse({ hits: { total: { value: 0 } } });
  assert.deepEqual(a, emptyAccounting());
});

test('emptyAccounting matches the fallback shape exactly', () => {
  assert.deepEqual(emptyAccounting(), {
    range: { from: null, to: null },
    totals: { requests: 0, promptTokens: 0, completionTokens: 0, tokens: 0, costUsd: 0 },
    byActor: [],
    byProject: [],
    byModel: [],
  });
});

// ─── range presets (pure) ────────────────────────────────────────────────────
test('isRangePreset validates the known presets only', () => {
  for (const ok of ['24h', '7d', '30d', '90d', 'all']) assert.equal(isRangePreset(ok), true, ok);
  for (const bad of ['1h', 'week', '', 'ALL']) assert.equal(isRangePreset(bad), false, bad);
});

test('resolveRange computes ISO bounds from an injected clock; all → no bounds', () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(resolveRange('all', now), { from: null, to: null });
  assert.deepEqual(resolveRange('24h', now), {
    from: new Date(now - 86_400_000).toISOString(),
    to: null,
  });
  assert.deepEqual(resolveRange('7d', now), {
    from: new Date(now - 7 * 86_400_000).toISOString(),
    to: null,
  });
});
