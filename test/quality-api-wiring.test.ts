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

test('sweep feedback reads the persisted response score shape', () => {
  const button = source('src/components/observability/RunSweepButton.tsx');
  assert.match(button, /data\.eval\?\.score/);
  assert.doesNotMatch(button, /data\.score/);
});
