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

test('canonical operations service routes reuse the topology-backed list and detail views', () => {
  const canonicalList = readFileSync(
    `${ROOT}src/app/(console)/operations/services/page.tsx`,
    'utf8',
  );
  const canonicalDetail = readFileSync(
    `${ROOT}src/app/(console)/operations/services/[serviceId]/page.tsx`,
    'utf8',
  );
  const topologyList = readFileSync(`${ROOT}src/app/(console)/gateway/services/page.tsx`, 'utf8');
  const topologyDetail = readFileSync(
    `${ROOT}src/app/(console)/gateway/services/[id]/page.tsx`,
    'utf8',
  );

  assert.match(
    canonicalList,
    /export \{ default \} from '@\/app\/\(console\)\/gateway\/services\/page'/,
  );
  assert.match(canonicalDetail, /LegacyServiceDetailPage/);
  assert.match(canonicalDetail, /serviceId.*id/s);
  assert.match(topologyList, /getRuntimeServiceTopologyRegistry\(\)\.list\(\)/);
  assert.match(topologyDetail, /getRuntimeServiceTopologyRegistry\(\)\.find\(id\)/);
});

test('fleet route shells consume the registry and never encode deployment membership', () => {
  const source = readFileSync(`${ROOT}src/components/operations/FleetTopology.tsx`, 'utf8');
  assert.match(source, /fetch\('\/api\/v1\/gateway\/fleet'/);
  assert.match(source, /deriveClusters\(nodes \?\? \[\]\)/);
  assert.doesNotMatch(source, /\b(?:S1|S2|g1|g2|g4|g5|g7|g8|Qwythos)\b/i);
  assert.match(source, /\/operations\/nodes\/\$\{encodeURIComponent\(node\.name\)\}/);
  assert.match(source, /\/operations\/clusters\/\$\{encodeURIComponent\(cluster\.head\.name\)\}/);
});

test('chat keeps its conversation rail off-canvas until the thread has desktop room', () => {
  const source = readFileSync(`${ROOT}src/components/chat/ChatWorkspace.tsx`, 'utf8');
  assert.match(source, /lg:static lg:z-auto lg:translate-x-0 lg:transition-none/);
  assert.equal(
    (source.match(/lg:hidden/g) ?? []).length,
    2,
    'the narrow-layout backdrop and chats-menu trigger must switch together',
  );
  assert.doesNotMatch(source, /md:static md:z-auto md:translate-x-0/);
});

test('canonical service journeys do not emit legacy navigation links', () => {
  const directory = readFileSync(`${ROOT}src/components/services/ServicesDirectory.tsx`, 'utf8');
  const detail = readFileSync(`${ROOT}src/components/services/ServiceDetail.tsx`, 'utf8');
  const detailPage = readFileSync(
    `${ROOT}src/app/(console)/gateway/services/[id]/page.tsx`,
    'utf8',
  );
  assert.match(directory, /`\/operations\/services\/\$\{s\.id\}`/);
  assert.match(detail, /href="\/operations\/services"/);
  assert.match(detailPage, /const logsHref = '\/operations\/health'/);
  assert.doesNotMatch(`${directory}\n${detail}`, /\/gateway\/services/);
});

test('gateway management tabs remain available without the legacy aggregator and own history', () => {
  const page = readFileSync(`${ROOT}src/app/(console)/gateway/ai/page.tsx`, 'utf8');
  const tabs = readFileSync(`${ROOT}src/components/gateway/GatewayTabs.tsx`, 'utf8');
  assert.match(page, /<GatewayTabs[\s\S]*overview=[\s\S]*<Suspense/);
  assert.match(tabs, /window\.history\.pushState/);
  assert.doesNotMatch(tabs, /window\.history\.replaceState/);
});
