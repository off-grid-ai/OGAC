import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  NAV_GROUPS,
  groupModules,
  sidebarActiveIdFor,
  sidebarActiveIdForPath,
  sidebarSectionIdForActiveId,
  sidebarSectionIdForPath,
  sidebarSections,
} from '../src/modules/groups.ts';
import { CANONICAL_OWNERS, IA_SECTIONS } from '../src/modules/ownership.ts';
import { MODULES } from '../src/modules/registry.ts';

test('the console has exactly the eight accepted top-level jobs in order', () => {
  assert.deepEqual(
    NAV_GROUPS.map(({ id, label }) => ({ id, label })),
    [
      { id: 'home', label: 'Home' },
      { id: 'work', label: 'Work' },
      { id: 'solutions', label: 'Solutions' },
      { id: 'data', label: 'Data' },
      { id: 'runtime', label: 'AI Runtime' },
      { id: 'governance', label: 'Governance' },
      { id: 'insights', label: 'Insights' },
      { id: 'operations', label: 'Operations' },
    ],
  );
  assert.deepEqual(
    NAV_GROUPS.map((group) => group.id),
    IA_SECTIONS.map((section) => section.id),
  );
  assert.equal(NAV_GROUPS.find((group) => group.id === 'home')?.navigation, 'direct');
  assert.ok(
    NAV_GROUPS.filter((group) => group.id !== 'home').every(
      (group) => group.navigation === 'grouped',
    ),
  );
  assert.deepEqual(
    Object.fromEntries(NAV_GROUPS.map((group) => [group.id, group.dashboardRoute])),
    {
      home: '/overview',
      work: '/work',
      solutions: '/solutions',
      data: '/data',
      runtime: '/runtime',
      governance: '/governance',
      insights: '/insights',
      operations: '/operations',
    },
  );
});

test('every canonical entity has exactly one owner and one canonical route', () => {
  const ids = new Set<string>();
  const routes = new Set<string>();
  for (const owner of CANONICAL_OWNERS) {
    assert.ok(!ids.has(owner.id), `duplicate canonical owner id: ${owner.id}`);
    assert.ok(!routes.has(owner.route), `duplicate canonical route: ${owner.route}`);
    ids.add(owner.id);
    routes.add(owner.route);
    assert.ok(IA_SECTIONS.some((section) => section.id === owner.section));
  }
});

test('entity collision decisions are represented in canonical ownership', () => {
  const byId = new Map(CANONICAL_OWNERS.map((owner) => [owner.id, owner]));
  assert.equal(byId.get('apps')?.route, '/solutions/apps');
  assert.equal(byId.get('agents')?.route, '/solutions/agents');
  assert.equal(byId.get('solution-library')?.route, '/solutions/library');
  assert.equal(byId.get('solution-deployments')?.route, '/solutions/deployed');
  assert.equal(byId.get('runs')?.route, '/operations/runs');
  assert.equal(byId.get('runtime-pipelines')?.route, '/runtime/pipelines');
  assert.equal(byId.get('data-flows')?.route, '/data/flows');
  assert.equal(byId.get('evidence')?.section, 'governance');
  assert.equal(byId.get('platform-health')?.section, 'operations');
  assert.equal(byId.get('outcomes')?.section, 'insights');
  assert.equal(byId.get('cost')?.section, 'insights');
});

test('sidebar is derived from explicit placements and never invents a More group', () => {
  const sections = sidebarSections(MODULES);
  assert.ok(sections.every((section) => section.label !== 'More'));
  assert.deepEqual(
    sections.map((section) => section.id),
    NAV_GROUPS.map((group) => group.id),
  );
  assert.ok(
    sections.every((section) => section.items.every((item) => item.placement === 'sidebar')),
  );
});

test('every standalone collection is in the sidebar and contextual resources declare a parent', () => {
  const sidebar = sidebarSections(MODULES).flatMap((section) => section.items);
  const required = [
    'prompts',
    'artifacts',
    'domains',
    'warehouse',
    'catalog',
    'lineage',
    'teams',
    'guardrails',
    'secrets',
    'trust',
    'usage',
    'quality-definitions',
    'edge',
    'managed-devices',
    'configuration',
    'backups',
    'admin',
  ];
  for (const id of required)
    assert.ok(
      sidebar.some((owner) => owner.id === id),
      `${id} missing`,
    );

  const contextual = CANONICAL_OWNERS.filter((owner) => owner.placement === 'contextual');
  assert.deepEqual(
    contextual.map((owner) => owner.id),
    ['solution-deployments', 'templates', 'agents', 'sandbox', 'quality-results', 'clusters'],
  );
  // Solutions previously showed TEN top-level rows, four of them different flavours of "reusable
  // thing". A deployment is a STATE of a blueprint and a template IS an app, so both now live inside
  // their parent rather than beside it.
  assert.equal(
    contextual.find((owner) => owner.id === 'solution-deployments')?.sidebarParent,
    'solution-library',
  );
  assert.equal(contextual.find((owner) => owner.id === 'templates')?.sidebarParent, 'apps');
  assert.equal(contextual.find((owner) => owner.id === 'agents')?.sidebarParent, 'apps');
  assert.equal(contextual.find((owner) => owner.id === 'sandbox')?.sidebarParent, 'apps');
  assert.equal(
    contextual.find((owner) => owner.id === 'quality-results')?.sidebarParent,
    'quality-definitions',
  );
  assert.equal(contextual.find((owner) => owner.id === 'clusters')?.sidebarParent, 'nodes');
});

test('all canonical owners remain registered for global or contextual discovery', () => {
  const grouped = groupModules(MODULES).flatMap((section) => section.items);
  assert.deepEqual(
    new Set(grouped.map((owner) => owner.id)),
    new Set(CANONICAL_OWNERS.map((owner) => owner.id)),
  );
});

test('disabled commercial modules hide their owners without changing IA ownership', () => {
  const sections = sidebarSections([{ id: 'overview' }, { id: 'chat' }, { id: 'runs' }]);
  assert.deepEqual(
    sections.flatMap((section) => section.items.map((item) => item.id)),
    ['overview', 'chat', 'runs'],
  );
});

test('the sidebar accordion opens only the branch that owns the active item', () => {
  const sections = sidebarSections(MODULES);
  assert.equal(sidebarSectionIdForActiveId(sections, 'reviews'), 'solutions');
  assert.equal(sidebarSectionIdForActiveId(sections, 'services'), 'operations');
  assert.equal(sidebarSectionIdForActiveId(sections, undefined), undefined);
  assert.equal(sidebarSectionIdForPath(sections, '/solutions'), 'solutions');
  assert.equal(sidebarSectionIdForPath(sections, '/solutions/apps/app-42'), 'solutions');
  assert.equal(sidebarSectionIdForPath(sections, '/nowhere'), undefined);
});

test('contextual routes highlight their declared sidebar parent and dynamic routes keep ownership', () => {
  assert.equal(sidebarActiveIdFor('clusters'), 'nodes');
  assert.equal(sidebarActiveIdFor('quality-results'), 'quality-definitions');
  assert.equal(sidebarActiveIdForPath('/insights/quality/drift'), 'quality-definitions');
  assert.equal(sidebarActiveIdForPath('/operations/clusters/from-registry'), 'nodes');
  assert.equal(sidebarActiveIdForPath('/operations/services/langfuse'), 'services');
  assert.equal(
    sidebarActiveIdForPath('/runtime/pipelines/credit-risk/policy'),
    'runtime-pipelines',
  );
  assert.equal(sidebarActiveIdForPath('/solutions/apps/app-42/runs'), 'apps');
  assert.equal(sidebarActiveIdForPath('/solutions/agents/fnol-intake'), 'apps');
  assert.equal(sidebarActiveIdForPath('/nowhere'), undefined);
});

test('a contextual sidebar parent is a sidebar owner in the same section', () => {
  const byId = new Map(CANONICAL_OWNERS.map((owner) => [owner.id, owner]));
  for (const owner of CANONICAL_OWNERS) {
    if (!owner.sidebarParent) continue;
    const parent = byId.get(owner.sidebarParent);
    assert.equal(parent?.placement, 'sidebar', `${owner.id} sidebar parent must be global`);
    assert.equal(
      parent.section,
      owner.section,
      `${owner.id} sidebar parent must share its section`,
    );
  }
});

test('the Solutions sidebar stays consolidated — no flat wall of sibling collections', () => {
  const section = sidebarSections(MODULES).find((candidate) => candidate.id === 'solutions');
  assert.ok(section, 'solutions section must exist');

  // Was SEVEN top-level rows: Apps, Library, Deployed, Templates, Reviews, Tools, Quality — four of
  // them different flavours of "reusable thing", with nothing stating how they related. A deployment
  // is a STATE of a blueprint and a template IS an app, so both are now contextual: discovered inside
  // their parent's page, which is what `placement: 'contextual'` has always meant here.
  assert.deepEqual(section.items.map((item) => item.label), [
    'Apps',
    'Blueprints',
    'Reviews',
    'Tools',
    'Quality',
  ]);
});

/**
 * Read a route's page source, following a one-line `export { default } from '@/...'` re-export.
 * Several console routes are thin aliases onto a shared implementation, so reading the route file
 * alone would assert against an import statement rather than the surface the operator sees.
 */
function pageSource(route: string): string {
  const source = readFileSync(`src/app/(console)/${route}/page.tsx`, 'utf8');
  const reexport = /export \{ default \} from '@\/(.+?)';/.exec(source.trim());
  return reexport ? readFileSync(`src/${reexport[1]}.tsx`, 'utf8') : source;
}

test('demoted Solutions collections stay reachable from their parent surface', () => {
  // Contextual owners are deliberately absent from the sidebar, so the parent PAGE is the only way in.
  // If that link is missing the surface is orphaned — a worse defect than a long sidebar.
  assert.match(
    pageSource('solutions/apps'),
    /\/solutions\/templates/,
    'the Apps page must link Templates',
  );
  assert.match(
    pageSource('solutions/library'),
    /\/solutions\/deployed/,
    'the Blueprints page must link Deployed',
  );
});
