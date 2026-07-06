import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAuditStats,
  buildDriftStats,
  buildSiemStats,
} from '../src/lib/insights-stats.ts';

// Pure stat-band builders for the Insights surfaces. No IO, no mocks — view-model in, StatTile[]
// out. Covers tone logic (the only real decision), the drifted-feature count, and int formatting.

test('buildSiemStats: quiet feed reads good; any block reads bad', () => {
  const quiet = buildSiemStats({
    total: 12,
    blockedDenied: 0,
    distinctActors: 3,
    distinctOutcomes: 2,
  });
  assert.deepEqual(
    quiet.map((s) => [s.label, s.value, s.tone]),
    [
      ['Events', '12', 'default'],
      ['Blocked / denied', '0', 'good'],
      ['Distinct actors', '3', 'default'],
      ['Outcomes', '2', 'default'],
    ],
  );

  const noisy = buildSiemStats({
    total: 1200,
    blockedDenied: 4,
    distinctActors: 9,
    distinctOutcomes: 4,
  });
  const blocked = noisy.find((s) => s.label === 'Blocked / denied');
  assert.equal(blocked?.tone, 'bad');
  // Thousands separator applied.
  assert.equal(noisy[0].value, '1,200');
});

test('buildDriftStats: verdict tone maps by status; drifted count is a fraction', () => {
  const stable = buildDriftStats({
    status: 'stable',
    driftScore: 0.02,
    features: [{ drifted: false }, { drifted: false }],
    baseline: 20,
    current: 20,
  });
  assert.equal(stable[0].value, 'stable');
  assert.equal(stable[0].tone, 'good');
  assert.equal(stable[1].value, '0.02');
  assert.equal(stable[2].value, '0/2');
  assert.equal(stable[2].tone, 'good');
  assert.equal(stable[3].value, '20 / 20');

  const drifted = buildDriftStats({
    status: 'drift',
    driftScore: null,
    features: [{ drifted: true }, { drifted: false }, { drifted: true }],
    baseline: 100,
    current: 80,
  });
  assert.equal(drifted[0].tone, 'bad');
  assert.equal(drifted[1].value, '—'); // null score
  assert.equal(drifted[2].value, '2/3');
  assert.equal(drifted[2].tone, 'warn');

  const warn = buildDriftStats({
    status: 'warning',
    driftScore: 0.15,
    features: [],
    baseline: 0,
    current: 0,
  });
  assert.equal(warn[0].tone, 'warn');
  assert.equal(warn[2].value, '0/0');
  assert.equal(warn[2].tone, 'good'); // no drifted features → good
});

test('buildAuditStats: shapes total + distinct facet counts, all default tone', () => {
  const stats = buildAuditStats({
    total: 4210,
    distinctActors: 12,
    distinctActions: 7,
    distinctProjects: 3,
  });
  assert.deepEqual(
    stats.map((s) => [s.label, s.value, s.tone]),
    [
      ['Events', '4,210', 'default'],
      ['Actors', '12', 'default'],
      ['Actions', '7', 'default'],
      ['Projects', '3', 'default'],
    ],
  );
});

test('int formatting: non-finite falls back to em dash', () => {
  const [events] = buildAuditStats({
    total: Number.NaN,
    distinctActors: 0,
    distinctActions: 0,
    distinctProjects: 0,
  });
  assert.equal(events.value, '—');
});
