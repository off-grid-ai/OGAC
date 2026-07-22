import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('QA status API and UI share one tenant-scoped status reader', () => {
  const route = source('src/app/api/v1/admin/qa/status/route.ts');
  assert.match(route, /readQaStatus\(await currentOrgId\(\)\)/);
  assert.doesNotMatch(route, /listEvalRuns|getDrift\(\)/);
});

test('manual QA sweep scopes eval, drift, and rollback to the authenticated org', () => {
  const route = source('src/app/api/v1/admin/qa/sweep/route.ts');
  const sweep = source('src/lib/qa/sweep.ts');
  assert.match(route, /runQaSweep\(\{ orgId: await currentOrgId\(\) \}\)/);
  assert.match(sweep, /getEvals\(\)\.run\(opts\.orgId\)/);
  assert.match(sweep, /getDrift\(\)\.analyze\(\{ orgId: opts\.orgId \}\)/);
  assert.match(sweep, /autoRollbackOnSweep\(drift\.status, \{ orgId: opts\.orgId \}\)/);
});

test('interactive drift reads and runs are tenant-scoped', () => {
  const route = source('src/app/api/v1/admin/drift/route.ts');
  const legacyRoute = source('src/app/api/v1/admin/qa/drift/route.ts');
  const page = source('src/app/(console)/solutions/quality/drift/page.tsx');
  // GET resolves once inline; POST resolves once into orgId and reuses it for its read + retained run.
  assert.equal(route.match(/await currentOrgId\(\)/g)?.length, 2);
  assert.match(route, /readDriftView\(\{ orgId: await currentOrgId\(\) \}\)/);
  assert.match(route, /const orgId = await currentOrgId\(\);/);
  assert.match(route, /readDriftView\(\{\s+orgId,\s+preset:/);
  assert.match(route, /recordDriftRun\([\s\S]*?,\s+orgId,\s+\);/);
  assert.match(legacyRoute, /analyze\(\{ orgId: await currentOrgId\(\) \}\)/);
  // The page also resolves once and threads that same tenant through both current and retained data.
  assert.equal(page.match(/await currentOrgId\(\)/g)?.length, 1);
  assert.match(page, /const orgId = await currentOrgId\(\);/);
  assert.match(page, /readDriftView\(\{ orgId \}\)/);
  assert.match(page, /listDriftRuns\(10, orgId\)/);
});

test('sweep feedback reads the persisted response score shape', () => {
  const button = source('src/components/observability/RunSweepButton.tsx');
  assert.match(button, /data\.eval\?\.score/);
  assert.doesNotMatch(button, /data\.score/);
});
