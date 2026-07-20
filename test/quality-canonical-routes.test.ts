import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

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
  assert.match(drift, /readDriftView\(\{ orgId: await currentOrgId\(\) \}\)/);
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
