import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  contextualDestinationForPath,
  contextualModule,
} from '../src/modules/contextual-navigation.ts';

const root = new URL('../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('canonical Quality routes expose executions, drift, performance, and release gates', () => {
  for (const path of [
    'src/app/(console)/solutions/quality/runs/[id]/page.tsx',
    'src/app/(console)/solutions/quality/drift/page.tsx',
    'src/app/(console)/solutions/quality/performance/page.tsx',
    'src/app/(console)/solutions/quality/release-gates/page.tsx',
  ])
    assert.equal(existsSync(new URL(path, root)), true, path);

  const run = source('src/app/(console)/solutions/quality/runs/[id]/page.tsx');
  const drift = source('src/app/(console)/solutions/quality/drift/page.tsx');
  const performance = source('src/app/(console)/solutions/quality/performance/page.tsx');
  const gates = source('src/app/(console)/solutions/quality/release-gates/page.tsx');
  assert.match(run, /getEvalRun\(id, await currentOrgId\(\)\)/);
  assert.equal(drift.match(/await currentOrgId\(\)/g)?.length, 1);
  assert.match(drift, /const orgId = await currentOrgId\(\);/);
  assert.match(drift, /readDriftView\(\{ orgId \}\)/);
  assert.match(drift, /listDriftRuns\(10, orgId\)/);
  assert.match(drift, /<DriftCatalog/);
  assert.match(performance, /readQaStatus\(orgId\)/);
  assert.match(performance, /<RunSweepButton/);
  assert.match(gates, /buildReleaseGatePortfolio/);
  assert.match(gates, /<ThresholdManager/);
  assert.match(gates, /\/runtime\/pipelines\/\$\{row\.pipelineId\}\/quality/);
  assert.match(performance, /\/solutions\/quality\/golden-cases/);
  assert.match(performance, /\/solutions\/quality\/release-gates/);
  assert.match(performance, /\/operations\/services\/evidently/);
  assert.doesNotMatch(performance, /\/gateway\/services/);
});

test('Quality root reveals current posture before configuration CRUD', () => {
  const rootPage = source('src/app/(console)/solutions/quality/page.tsx');
  assert.match(rootPage, /redirect\('\/solutions\/quality\/performance'\)/);
});

test('Quality executions resolves its canonical runs segment instead of treating it as a menu id', () => {
  const module = contextualModule('solutions-quality');
  assert.equal(contextualDestinationForPath(module, '/solutions/quality/runs')?.id, 'executions');

  const destinationPage = source('src/app/(console)/solutions/quality/[destination]/page.tsx');
  assert.match(destinationPage, /contextualDestinationForPath/);
  assert.doesNotMatch(destinationPage, /contextualDestination\(contextualModule/);
});

test('Quality card guidance uses the shared description row without header overlap', () => {
  const cards = [
    ['src/app/(console)/solutions/quality/[destination]/page.tsx', 'Used by pipelines'],
    ['src/app/(console)/solutions/quality/[destination]/page.tsx', 'Execution filters'],
    ['src/app/(console)/solutions/quality/performance/page.tsx', 'Score history'],
    ['src/app/(console)/solutions/quality/drift/page.tsx', 'Current drift evidence'],
    ['src/app/(console)/solutions/quality/drift/page.tsx', 'Run a drift check'],
    ['src/app/(console)/solutions/quality/release-gates/page.tsx', 'Pipeline release gates'],
    ['src/components/observability/ThresholdManager.tsx', 'Alert thresholds'],
  ] as const;

  for (const [path, title] of cards) {
    const header = [...source(path).matchAll(/<CardHeader[\s\S]*?<\/CardHeader>/g)].find((match) =>
      match[0].includes(title),
    )?.[0];
    assert.ok(header, `${path} must render the ${title} card header`);
    assert.match(header, /<CardDescription\b/);
    assert.doesNotMatch(header, /<p\b/);
  }
});

test('retired Insights Quality routes preserve query state and redirect to canonical ownership', () => {
  const redirects = {
    'src/app/(console)/insights/quality/drift/page.tsx': '/solutions/quality/drift',
    'src/app/(console)/insights/quality/scorecards/page.tsx': '/solutions/quality/performance',
    'src/app/(console)/insights/quality/thresholds/page.tsx': '/solutions/quality/release-gates',
  };
  for (const [path, target] of Object.entries(redirects)) {
    const page = source(path);
    assert.match(page, /insightsRouteWithSearchParams/);
    assert.ok(page.includes(`'${target}'`));
  }
  const detail = source('src/app/(console)/insights/quality/evals/[id]/page.tsx');
  assert.match(detail, /\/solutions\/quality\/runs\/\$\{encodeURIComponent\(id\)\}/);
});
