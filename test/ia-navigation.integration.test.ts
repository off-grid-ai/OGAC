import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { canonicalPath } from '../src/modules/route-migrations.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const routeFile = (pathname: string) =>
  `${ROOT}src/app/(console)${pathname.replace(/\[[^\]]+\]/g, (segment) => segment)}/page.tsx`;

function routePageExists(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);

  function visit(directory: string, index: number): boolean {
    if (index === segments.length) {
      if (existsSync(`${directory}/page.tsx`)) return true;
      return readdirSync(directory, { withFileTypes: true }).some(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith('(') &&
          entry.name.endsWith(')') &&
          visit(`${directory}/${entry.name}`, index),
      );
    }

    return readdirSync(directory, { withFileTypes: true }).some((entry) => {
      if (!entry.isDirectory()) return false;
      if (entry.name.startsWith('(') && entry.name.endsWith(')')) {
        return visit(`${directory}/${entry.name}`, index);
      }
      const ownsSegment =
        entry.name === segments[index] || (entry.name.startsWith('[') && entry.name.endsWith(']'));
      return ownsSegment && visit(`${directory}/${entry.name}`, index + 1);
    });
  }

  return visit(`${ROOT}src/app/(console)`, 0);
}

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
    assert.ok(routePageExists(canonical), `${legacy} → ${canonical} has no route page`);
  }
});

test('registry-driven operation resources have list and dynamic detail routes', () => {
  for (const pathname of ['/operations/nodes/[nodeId]', '/operations/clusters/[clusterId]']) {
    assert.ok(existsSync(routeFile(pathname)), `${pathname} is missing`);
  }
  for (const pathname of ['/operations/nodes', '/operations/clusters']) {
    const directoryPage = `${ROOT}src/app/(console)${pathname}/(directory)/page.tsx`;
    assert.ok(existsSync(directoryPage), `${pathname} directory is missing`);
  }
  for (const pathname of ['/operations/services', '/operations/services/[serviceId]']) {
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
  assert.match(source, /topologyResourceHref\('nodes', node\.name\)/);
  assert.match(source, /topologyResourceHref\('clusters', cluster\.head\.name\)/);
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

test('canonical gateway and orchestration journeys never emit retired collection paths', () => {
  const gateways = readFileSync(`${ROOT}src/components/gateways/GatewaysManager.tsx`, 'utf8');
  const gateway = readFileSync(`${ROOT}src/components/gateways/GatewayDetail.tsx`, 'utf8');
  const createJob = readFileSync(`${ROOT}src/components/data/etl/NewEtlJobButton.tsx`, 'utf8');
  const jobActions = readFileSync(`${ROOT}src/components/data/EtlJobActions.tsx`, 'utf8');

  assert.match(gateways, /\/runtime\/gateways\/\$\{gw\.id\}/);
  assert.match(gateway, /router\.push\('\/runtime\/gateways'\)/);
  assert.doesNotMatch(`${gateways}\n${gateway}`, /\/gateway\/registry/);
  assert.match(createJob, /router\.push\(`\/data\/flows\/orchestration\/\$\{job\.id\}`\)/);
  assert.match(jobActions, /router\.push\('\/data\/flows\/orchestration'\)/);
  assert.doesNotMatch(`${createJob}\n${jobActions}`, /\/data\/etl/);
});

test('gateway model and API management places are durable routes', () => {
  const legacyPage = readFileSync(`${ROOT}src/app/(console)/gateway/ai/page.tsx`, 'utf8');
  const modelsPage = readFileSync(
    `${ROOT}src/app/(console)/runtime/models/[destination]/page.tsx`,
    'utf8',
  );
  const apiBudgetsPage = readFileSync(
    `${ROOT}src/app/(console)/runtime/api-budgets/[destination]/page.tsx`,
    'utf8',
  );

  assert.match(legacyPage, /legacyGatewayRedirect/);
  assert.match(modelsPage, /contextualModule\('runtime-models'\)/);
  assert.match(modelsPage, /<GatewayModelDestination/);
  assert.match(apiBudgetsPage, /contextualModule\('runtime-api-budgets'\)/);
  assert.match(apiBudgetsPage, /<GatewayApiBudgetDestination/);
  assert.equal(existsSync(`${ROOT}src/components/gateway/GatewayTabs.tsx`), false);
});
