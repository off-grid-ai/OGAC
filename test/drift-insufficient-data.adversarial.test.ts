import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDrift } from '../src/lib/drift-view.ts';
import { buildDriftStats } from '../src/lib/insights-stats.ts';

// ADVERSARIAL — G-ADV-OBS-3
// Drift with INSUFFICIENT data reports a confident, reassuring "stable" verdict.
//
// Terminal artifact the operator sees: the Drift page (insights/drift/page.tsx) renders a green
// `stable` badge + StatBand "Verdict: stable" (tone 'good') whenever normalizeDrift returns status
// 'stable'. normalizeDrift has NO notion of sample sufficiency: an Evidently report with zero
// reference/current samples and no drifted columns collapses to status 'stable', drifted:false.
// The header even prints "baseline 0 vs current 0 samples" beside a green STABLE badge.
//
// This is dangerously misleading: "we could not measure drift (no data)" is presented as "no drift".
// DriftDisplayStatus has no 'insufficient'/'unknown' member. Un-skip to watch it FAIL.
test.skip('ADVERSARIAL G-ADV-OBS-3: zero-sample drift is not reported as a green "stable" verdict', () => {
  const view = normalizeDrift({
    engine: 'evidently',
    dataset_drift: false,
    number_of_columns: 0,
    number_of_drifted_columns: 0,
    reference_size: 0,
    current_size: 0,
    columns: [],
  });

  // With no samples at all we cannot honestly assert "stable". The verdict the user reads must not be
  // a reassuring green 'stable'.
  assert.notEqual(
    view.status,
    'stable',
    'zero-sample drift reported as "stable" — false reassurance (no insufficient/unknown state)',
  );

  // And the StatBand tone must not paint it 'good'.
  const verdict = buildDriftStats({
    status: view.status as 'stable' | 'warning' | 'drift',
    driftScore: view.driftScore,
    features: view.features,
    baseline: view.baseline,
    current: view.current,
  })[0];
  assert.notEqual(verdict.tone, 'good', 'insufficient-data drift painted green/good in the StatBand');
});
