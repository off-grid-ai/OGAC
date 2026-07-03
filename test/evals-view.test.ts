import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeEvals } from '../src/lib/evals-view.ts';

// Unit tests for the PURE evals normalizer — no mocks, no I/O. Exercises the real rollup rule that
// drives the read-back page: aggregate counts, pass-rate %, per-suite rollup, recent-first order,
// and defensive handling of empty/malformed records.

test('normalizeEvals: aggregates counts and pass-rate across runs', () => {
  const v = normalizeEvals({
    runs: [
      { id: 'a', engine: 'golden', score: 80, total: 10, passed: 8, startedAt: '2026-07-01T00:00:00Z' },
      { id: 'b', engine: 'golden', score: 50, total: 10, passed: 5, startedAt: '2026-07-02T00:00:00Z' },
    ],
    goldenCases: [{ id: 'gc1' }, { id: 'gc2' }],
  });
  assert.equal(v.totals.runs, 2);
  assert.equal(v.totals.cases, 20);
  assert.equal(v.totals.passed, 13);
  assert.equal(v.totals.failed, 7);
  assert.equal(v.totals.passRate, 65); // 13/20
  assert.equal(v.goldenCases, 2);
});

test('normalizeEvals: recent runs are newest-first', () => {
  const v = normalizeEvals({
    runs: [
      { id: 'old', total: 1, passed: 1, startedAt: '2026-01-01T00:00:00Z' },
      { id: 'new', total: 1, passed: 1, startedAt: '2026-06-01T00:00:00Z' },
      { id: 'mid', total: 1, passed: 1, startedAt: '2026-03-01T00:00:00Z' },
    ],
  });
  assert.deepEqual(
    v.recentRuns.map((r) => r.id),
    ['new', 'mid', 'old'],
  );
});

test('normalizeEvals: per-suite rollup, most-recently-run first', () => {
  const v = normalizeEvals({
    runs: [
      { id: 'g1', engine: 'golden', total: 10, passed: 9, startedAt: '2026-07-01T00:00:00Z' },
      { id: 'p1', engine: 'promptfoo', total: 5, passed: 4, startedAt: '2026-07-03T00:00:00Z' },
      { id: 'g2', engine: 'golden', total: 10, passed: 6, startedAt: '2026-07-02T00:00:00Z' },
    ],
  });
  // promptfoo ran most recently (07-03) → its suite sorts first.
  assert.deepEqual(
    v.suites.map((s) => s.engine),
    ['promptfoo', 'golden'],
  );
  const golden = v.suites.find((s) => s.engine === 'golden')!;
  assert.equal(golden.runs, 2);
  assert.equal(golden.total, 20);
  assert.equal(golden.passed, 15);
  assert.equal(golden.failed, 5);
  assert.equal(golden.passRate, 75); // 15/20
  assert.equal(golden.lastRun, '2026-07-02T00:00:00Z');
});

test('normalizeEvals: runs missing an engine roll up under the golden default', () => {
  const v = normalizeEvals({ runs: [{ id: 'x', total: 4, passed: 2 }] });
  assert.equal(v.suites.length, 1);
  assert.equal(v.suites[0].engine, 'golden');
  assert.equal(v.recentRuns[0].engine, 'golden');
});

test('normalizeEvals: empty / nullish input yields a safe zeroed model', () => {
  for (const input of [undefined, null, {}, { runs: null, goldenCases: null }]) {
    const v = normalizeEvals(input as never);
    assert.equal(v.totals.runs, 0);
    assert.equal(v.totals.cases, 0);
    assert.equal(v.totals.passRate, 0);
    assert.deepEqual(v.suites, []);
    assert.deepEqual(v.recentRuns, []);
    assert.equal(v.goldenCases, 0);
  }
});

test('normalizeEvals: per-engine runs split into distinct suites (persisted engine)', () => {
  // Runs now carry the engine that produced them (golden persists in-process; promptfoo/ragas are
  // recorded via recordEvalRun), so a mixed set must roll up into one suite per engine.
  const v = normalizeEvals({
    runs: [
      { id: 'g', engine: 'golden', total: 4, passed: 4, startedAt: '2026-07-01T00:00:00Z' },
      { id: 'p', engine: 'promptfoo', total: 4, passed: 2, startedAt: '2026-07-02T00:00:00Z' },
      { id: 'r', engine: 'ragas', total: 4, passed: 3, startedAt: '2026-07-03T00:00:00Z' },
    ],
  });
  assert.deepEqual(
    v.suites.map((s) => s.engine).sort(),
    ['golden', 'promptfoo', 'ragas'],
  );
  assert.equal(v.suites.find((s) => s.engine === 'ragas')!.passRate, 75);
});

test('normalizeEvals: malformed records degrade safely (no negative/over-100)', () => {
  const v = normalizeEvals({
    runs: [
      // passed > total, garbage score, non-array-safe fields
      { id: 'm1', engine: 'promptfoo', score: 250, total: 3, passed: 9, startedAt: '2026-07-01T00:00:00Z' },
      // NaN / missing numerics, no id, no timestamp
      { engine: 'ragas', score: Number.NaN, total: undefined, passed: -4 },
    ] as never,
  });
  const m1 = v.recentRuns.find((r) => r.id === 'm1')!;
  assert.equal(m1.passed, 3); // capped at total
  assert.equal(m1.failed, 0); // never negative
  assert.equal(m1.score, 100); // clamped 0..100

  const bad = v.recentRuns.find((r) => r.engine === 'ragas')!;
  assert.equal(bad.id, '(unknown)');
  assert.equal(bad.total, 0);
  assert.equal(bad.passed, 0);
  assert.equal(bad.failed, 0);
  assert.equal(bad.score, 0);
  assert.equal(bad.startedAt, null);

  // ragas (no timestamp) sinks below m1 in recent order.
  assert.equal(v.recentRuns[0].id, 'm1');
  assert.equal(v.totals.passRate, 100); // 3 passed / 3 cases
});
