import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveAnomalies, gatherWith, type CopilotReaders } from '@/lib/copilot-gather';
import type { FinOps } from '@/lib/finops';

// The gather layer is deliberately thin: deriveAnomalies runs the PURE anomaly detector over the
// finops cost series, and gatherWith orchestrates injected readers into a CopilotContext. We test
// both with real data + injected fake readers (the documented test seam) — no DB, no gateway.

function finopsWith(daily: { day: string; costUsd: number }[]): FinOps {
  return {
    totals: { requests: 0, tokens: 0, costUsd: 0, localShare: 0 },
    byModel: [],
    bySubject: [],
    byKey: [],
    daily,
  };
}

test('deriveAnomalies: null finops → no scans', () => {
  assert.deepEqual(deriveAnomalies(null), []);
});

test('deriveAnomalies: fewer than 4 days of history → not enough to scan', () => {
  const fin = finopsWith([
    { day: '2026-01-01', costUsd: 10 },
    { day: '2026-01-02', costUsd: 11 },
    { day: '2026-01-03', costUsd: 10 },
  ]);
  assert.deepEqual(deriveAnomalies(fin), []);
});

test('deriveAnomalies: a clear spike in the daily cost series is flagged', () => {
  const days = [10, 11, 10, 12, 11, 10, 9, 250]; // last day is a large spike
  const fin = finopsWith(
    days.map((c, i) => ({ day: `2026-01-0${i + 1}`, costUsd: c })),
  );
  const out = deriveAnomalies(fin);
  assert.equal(out.length, 1);
  assert.equal(out[0].metric, 'daily cost');
  assert.ok(out[0].scan.anomalies.length > 0, 'expected the spike to be detected');
});

test('deriveAnomalies: a flat series (no spikes) yields no anomaly entry', () => {
  const fin = finopsWith(
    Array.from({ length: 8 }, (_, i) => ({ day: `2026-02-0${i + 1}`, costUsd: 10 })),
  );
  assert.deepEqual(deriveAnomalies(fin), []);
});

test('gatherWith: orchestrates injected readers into a CopilotContext, deriving anomalies from finops', async () => {
  const fin = finopsWith(
    [10, 11, 10, 12, 11, 10, 9, 300].map((c, i) => ({ day: `2026-03-0${i + 1}`, costUsd: c })),
  );
  const readers: CopilotReaders = {
    audit: async () => ({ rows: [], configured: true }),
    finops: async () => fin,
    drift: async () => null,
    evals: async () => null,
  };
  const ctx = await gatherWith('why did spend jump?', readers);
  assert.equal(ctx.question, 'why did spend jump?');
  assert.equal(ctx.audit.configured, true);
  assert.equal(ctx.finops, fin);
  assert.equal(ctx.drift, null);
  assert.equal(ctx.evals, null);
  // anomalies are derived from the finops series inside gatherWith.
  assert.ok(ctx.anomalies.length >= 1);
});

test('gatherWith: with no finops, anomalies are empty and other sources pass through', async () => {
  const readers: CopilotReaders = {
    audit: async () => ({ rows: [], configured: false }),
    finops: async () => null,
    drift: async () => null,
    evals: async () => null,
  };
  const ctx = await gatherWith('status?', readers);
  assert.deepEqual(ctx.anomalies, []);
  assert.equal(ctx.finops, null);
  assert.equal(ctx.audit.configured, false);
});
