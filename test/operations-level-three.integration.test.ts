import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ADMIN_DESTINATIONS,
  CONFIGURATION_DESTINATIONS,
  EDGE_DESTINATIONS,
  HEALTH_DESTINATIONS,
} from '../src/lib/operations-destinations.ts';
import { contextualModule } from '../src/modules/contextual-navigation.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, 'utf8');

test('Operations contextual modules consume the canonical destination arrays', () => {
  assert.deepEqual(contextualModule('operations-health').destinations, HEALTH_DESTINATIONS);
  assert.deepEqual(
    contextualModule('operations-configuration').destinations,
    CONFIGURATION_DESTINATIONS,
  );
  assert.deepEqual(contextualModule('operations-edge').destinations, EDGE_DESTINATIONS);
  assert.deepEqual(contextualModule('operations-admin').destinations, ADMIN_DESTINATIONS);
});

test('every Operations collection has a base redirect, contextual layout, and leaf route', () => {
  for (const module of ['health', 'configuration', 'edge', 'admin']) {
    const base = `src/app/(console)/operations/${module}`;
    assert.match(read(`${base}/page.tsx`), /redirect\(/);
    assert.match(read(`${base}/layout.tsx`), /ContextualModuleShell/);
    assert.ok(existsSync(`${ROOT}${base}/[destination]/page.tsx`));
    assert.doesNotMatch(read(`${base}/[destination]/page.tsx`), /<h1\b/i);
  }
});

test('legacy health, edge, configuration, messaging, and integrations pages only redirect', () => {
  for (const route of [
    'src/app/(console)/insights/platform/page.tsx',
    'src/app/(console)/gateway/edge/page.tsx',
    'src/app/(console)/operations/config/page.tsx',
    'src/app/(console)/operations/messaging/page.tsx',
    'src/app/(console)/data/integrations/page.tsx',
  ]) {
    const source = read(route);
    assert.match(source, /redirect\(/);
    assert.match(source, /RouteSearchParams/);
    assert.doesNotMatch(source, /<PageFrame|<Card|<Table|Manager\s*\//);
  }
});

test('canonical configuration leaves retain management actions without duplicate Admin controls', () => {
  const configuration = read('src/components/config/ConfigurationDestination.tsx');
  const adapters = read('src/components/config/AdaptersDestination.tsx');
  const admin = read('src/components/admin/AdminDestination.tsx');

  for (const control of [
    'ConfigManager',
    'FlagManager',
    'MessagingManager',
    'WorkspacePipelineBinding',
  ]) {
    assert.match(configuration, new RegExp(control));
  }
  for (const control of [
    'ConnectorCatalog',
    'AddConnectorButton',
    'ConnectorCard',
    'ToolPolicySelect',
    'AdapterCatalog',
  ]) {
    assert.match(adapters, new RegExp(control));
  }
  assert.match(admin, /OrgInstructionsEditor/);
  assert.match(admin, /AddTenantButton/);
  assert.match(admin, /DeleteRowButton/);
  assert.doesNotMatch(admin, /FlagManager|WorkspacePipelineBinding|AddCustomRoleButton|AbacTester/);
});

test('edge blocked-request filters and WAF detail navigation are URL-driven', () => {
  const edge = read('src/components/edge/EdgePanel.tsx');
  const waf = read('src/components/edge/WafControls.tsx');
  const config = read('src/components/config/ConfigManager.tsx');

  assert.match(edge, /useSearchParams\(\)/);
  assert.match(edge, /params\.get\('q'\)/);
  assert.match(edge, /params\.get\('kind'\)/);
  assert.match(edge, /params\.get\('sort'\)/);
  assert.match(edge, /params\.get\('direction'\)/);
  assert.match(waf, /router\.push\(panelHref/);
  assert.match(config, /searchParams\.get\('q'\)/);
});
