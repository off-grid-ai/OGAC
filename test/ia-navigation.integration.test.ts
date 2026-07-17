import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { canonicalPath } from '../src/modules/route-migrations.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const routeFile = (pathname: string) =>
  `${ROOT}src/app/(console)${pathname.replace(/\[[^\]]+\]/g, (segment) => segment)}/page.tsx`;

test('representative legacy links resolve to checked-in canonical route pages', () => {
  for (const legacy of [
    '/workspace/chat',
    '/build/apps/[id]/runs/[runId]',
    '/build/pipelines/[id]/policy',
    '/data/etl/[id]',
    '/data/retrieval',
    '/gateway/services/[serviceId]',
    '/insights/audit',
    '/insights/evals/[id]',
    '/operations/messaging',
  ]) {
    const canonical = canonicalPath(legacy);
    assert.ok(existsSync(routeFile(canonical)), `${legacy} → ${canonical} has no route page`);
  }
});

test('registry-driven operation resources have list and dynamic detail routes', () => {
  for (const pathname of [
    '/operations/nodes',
    '/operations/nodes/[nodeId]',
    '/operations/clusters',
    '/operations/clusters/[clusterId]',
    '/operations/services',
    '/operations/services/[serviceId]',
  ]) {
    assert.ok(existsSync(routeFile(pathname)), `${pathname} is missing`);
  }
});

test('fleet route shells consume the registry and never encode deployment membership', () => {
  const source = readFileSync(`${ROOT}src/components/operations/FleetTopology.tsx`, 'utf8');
  assert.match(source, /fetch\('\/api\/v1\/gateway\/fleet'/);
  assert.match(source, /deriveClusters\(nodes \?\? \[\]\)/);
  assert.doesNotMatch(source, /\b(?:S1|S2|g1|g2|g4|g5|g7|g8|Qwythos)\b/i);
  assert.match(source, /\/operations\/nodes\/\$\{encodeURIComponent\(node\.name\)\}/);
  assert.match(source, /\/operations\/clusters\/\$\{encodeURIComponent\(cluster\.head\.name\)\}/);
});
