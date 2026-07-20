import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildQualityPerformance,
  buildReleaseGatePortfolio,
  performanceStatus,
} from '../src/lib/quality-operator-view.ts';

const run = (id: string, score: number, day: number) => ({
  id,
  score,
  startedAt: `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`,
});

test('performance status owns the warning and degradation boundaries', () => {
  assert.equal(performanceStatus(-15), 'degraded');
  assert.equal(performanceStatus(-7), 'warning');
  assert.equal(performanceStatus(-6.9), 'stable');
});

test('performance view reports insufficient history without inventing a baseline', () => {
  const empty = buildQualityPerformance([]);
  assert.equal(empty.status, 'insufficient');
  assert.equal(empty.latestScore, null);
  assert.equal(empty.currentMean, null);

  const partial = buildQualityPerformance([run('new', 120, 2), run('old', Number.NaN, 1)]);
  assert.equal(partial.latestScore, 100);
  assert.equal(partial.currentMean, 50);
  assert.equal(partial.baselineMean, null);
  assert.deepEqual(partial.trend.map((point) => point.runId), ['old', 'new']);
});

test('performance view compares equal recent and baseline windows', () => {
  const view = buildQualityPerformance([
    run('r4', 60, 4),
    run('r3', 70, 3),
    run('r2', 90, 2),
    run('r1', 90, 1),
  ]);
  assert.equal(view.status, 'degraded');
  assert.equal(view.currentMean, 65);
  assert.equal(view.baselineMean, 90);
  assert.equal(view.delta, -25);
  assert.equal(view.currentCount, 2);
  assert.equal(view.baselineCount, 2);
});

test('release gate portfolio projects every persisted operator state', () => {
  const pipelines = [
    { id: 'a', name: 'Alpha', status: 'draft' },
    { id: 'b', name: 'Bravo', status: 'published' },
    { id: 'c', name: 'Charlie', status: 'draft' },
    { id: 'd', name: 'Delta', status: 'draft' },
    { id: 'e', name: 'Echo', status: 'published' },
    { id: 'f', name: 'Foxtrot', status: 'published' },
  ];
  const definitions = ['b', 'c', 'd', 'e', 'f'].map((pipelineId) => ({
    id: `eval-${pipelineId}`,
    pipelineId,
  }));
  definitions.push({ id: 'library', pipelineId: null });
  const jobs = [
    {
      jobId: 'old-c', pipelineId: 'c', status: 'blocked' as const,
      createdAt: '2026-07-01T00:00:00Z', overridden: false, summary: 'old',
    },
    {
      jobId: 'new-c', pipelineId: 'c', status: 'gating' as const,
      createdAt: '2026-07-02T00:00:00Z', overridden: false, summary: null,
    },
    {
      jobId: 'd', pipelineId: 'd', status: 'blocked' as const,
      createdAt: null, overridden: false, summary: 'below threshold',
    },
    {
      jobId: 'e', pipelineId: 'e', status: 'published' as const,
      createdAt: '2026-07-03T00:00:00Z', overridden: true, summary: 'override audited',
    },
    {
      jobId: 'f', pipelineId: 'f', status: 'published' as const,
      createdAt: '2026-07-04T00:00:00Z', overridden: false, summary: null,
    },
  ];

  const view = buildReleaseGatePortfolio(pipelines, definitions, jobs);
  assert.deepEqual(view.map((row) => row.status), [
    'ungated', 'not-run', 'running', 'blocked', 'overridden', 'passed',
  ]);
  assert.match(view[0].summary, /without a quality verdict/);
  assert.match(view[1].summary, /not run yet/);
  assert.match(view[2].summary, /running/);
  assert.equal(view[3].summary, 'below threshold');
  assert.equal(view[4].summary, 'override audited');
  assert.match(view[5].summary, /no decision summary/);
});
