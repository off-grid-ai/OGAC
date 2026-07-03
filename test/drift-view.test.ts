import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDrift } from '../src/lib/drift-view.ts';

// Pure drift normalizer. No network, no mocks — sample Evidently JSON and adapter DriftReports in,
// asserted display model out. Covers drifted vs stable, both input shapes, and empty/malformed.

// ── Raw Evidently report shape (per-column drift, share, dataset flag) ──────────────────────────
const EVIDENTLY_DRIFTED = {
  drift_detected: true,
  dataset_drift: true,
  number_of_columns: 4,
  number_of_drifted_columns: 3,
  reference_size: 20,
  current_size: 20,
  timestamp: '2026-07-02T10:00:00Z',
  engine: 'evidently',
  drift_by_columns: {
    latency: { drift_detected: true, drift_score: 0.31, stattest_name: 'psi' },
    score: { drift_detected: true, drift_score: 0.27 },
    tokens: { drift_detected: false, drift_score: 0.02 },
    topic: { drift_detected: true, drift_score: 0.44 },
  },
};

test('normalizeDrift: Evidently report with dataset drift → drift verdict + per-feature rows', () => {
  const v = normalizeDrift(EVIDENTLY_DRIFTED);
  assert.equal(v.engine, 'evidently');
  assert.equal(v.status, 'drift');
  assert.equal(v.drifted, true);
  assert.equal(v.driftScore, 0.75); // 3 of 4 columns drifted
  assert.equal(v.baseline, 20);
  assert.equal(v.current, 20);
  assert.equal(v.lastChecked, '2026-07-02T10:00:00Z');
  assert.equal(v.features.length, 4);

  const latency = v.features.find((f) => f.name === 'latency');
  assert.ok(latency);
  assert.equal(latency.status, 'drift');
  assert.equal(latency.score, 0.31);
  assert.equal(latency.drifted, true);

  const tokens = v.features.find((f) => f.name === 'tokens');
  assert.ok(tokens);
  assert.equal(tokens.status, 'stable');
  assert.equal(tokens.drifted, false);
});

test('normalizeDrift: Evidently report with no drift → stable verdict', () => {
  const v = normalizeDrift({
    drift_detected: false,
    dataset_drift: false,
    number_of_columns: 2,
    number_of_drifted_columns: 0,
    columns: [
      { column_name: 'score', drift_detected: false, drift_score: 0.03 },
      { column_name: 'latency', drift_detected: false, drift_score: 0.05 },
    ],
  });
  assert.equal(v.status, 'stable');
  assert.equal(v.drifted, false);
  assert.equal(v.driftScore, 0);
  assert.equal(v.features.length, 2);
  assert.ok(v.features.every((f) => f.status === 'stable'));
});

test('normalizeDrift: Evidently borderline share (>0.1, not hard drift) → warning', () => {
  const v = normalizeDrift({
    drift_detected: false,
    dataset_drift: false,
    share_of_drifted_columns: 0.2,
    columns: [{ column_name: 'a', drift_detected: false, drift_score: 0.04 }],
  });
  assert.equal(v.status, 'warning');
  assert.equal(v.driftScore, 0.2);
});

// ── Adapter DriftReport shape (native PSI engine) ───────────────────────────────────────────────
test('normalizeDrift: native DriftReport with degradation → drift + metrics as features', () => {
  const v = normalizeDrift({
    engine: 'native',
    status: 'drift',
    baseline: 20,
    current: 20,
    note: 'Mean eval score down 18 pts vs the prior window.',
    metrics: [
      { name: 'score_psi', value: 0.31, status: 'drift' },
      { name: 'mean_delta', value: -18, status: 'drift' },
    ],
  });
  assert.equal(v.engine, 'native');
  assert.equal(v.status, 'drift');
  assert.equal(v.drifted, true);
  assert.equal(v.driftScore, 0.31); // strongest metric value
  assert.equal(v.baseline, 20);
  assert.equal(v.current, 20);
  assert.equal(v.note, 'Mean eval score down 18 pts vs the prior window.');
  assert.equal(v.features.length, 2);
  assert.equal(v.lastChecked, null);
  assert.equal(v.features[1].name, 'mean_delta');
  assert.equal(v.features[1].drifted, true);
});

test('normalizeDrift: native DriftReport stable', () => {
  const v = normalizeDrift({
    engine: 'native',
    status: 'stable',
    baseline: 10,
    current: 10,
    metrics: [
      { name: 'score_psi', value: 0.02, status: 'stable' },
      { name: 'mean_delta', value: 1.2, status: 'stable' },
    ],
  });
  assert.equal(v.status, 'stable');
  assert.equal(v.drifted, false);
  assert.ok(v.features.every((f) => f.status === 'stable' && !f.drifted));
});

// ── Empty / malformed inputs degrade safely ─────────────────────────────────────────────────────
test('normalizeDrift: empty native report (not enough history) → stable, no features', () => {
  const v = normalizeDrift({ engine: 'native', status: 'stable', metrics: [], baseline: 0, current: 3 });
  assert.equal(v.status, 'stable');
  assert.deepEqual(v.features, []);
  assert.equal(v.driftScore, null);
  assert.equal(v.current, 3);
});

test('normalizeDrift: null / undefined input → safe stable default', () => {
  for (const input of [null, undefined, {}]) {
    const v = normalizeDrift(input as never);
    assert.equal(v.status, 'stable');
    assert.equal(v.drifted, false);
    assert.equal(v.engine, 'unknown');
    assert.deepEqual(v.features, []);
    assert.equal(v.driftScore, null);
    assert.equal(v.note, null);
    assert.equal(v.lastChecked, null);
  }
});

test('normalizeDrift: malformed fields (bad types, missing names) are dropped', () => {
  const v = normalizeDrift({
    engine: 42 as never,
    status: 'bogus',
    metrics: [
      { name: 'ok', value: 0.5, status: 'drift' },
      { value: 9 } as never, // no name → dropped
      { name: '', value: 1 } as never, // empty name → dropped
    ],
  });
  assert.equal(v.engine, 'unknown'); // non-string engine ignored
  assert.equal(v.status, 'stable'); // unknown status → stable
  assert.equal(v.features.length, 1);
  assert.equal(v.features[0].name, 'ok');
});

test('normalizeDrift: Evidently columns array with NaN score → score coerced to null', () => {
  const v = normalizeDrift({
    dataset_drift: false,
    columns: [{ column_name: 'x', drift_detected: false, drift_score: NaN as never }],
  });
  assert.equal(v.features[0].score, null);
  assert.equal(v.features[0].status, 'stable');
});
