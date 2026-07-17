import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NAV_GROUPS,
  groupModules,
  sidebarActiveIdFor,
  sidebarActiveIdForPath,
  sidebarSectionIdForActiveId,
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
  assert.ok(sections.every((section) => section.items.every((item) => item.placement === 'sidebar')));
});

test('every standalone collection is in the sidebar and contextual resources declare a parent', () => {
  const sidebar = sidebarSections(MODULES).flatMap((section) => section.items);
  const required = [
    'prompts', 'artifacts', 'domains', 'warehouse', 'catalog', 'lineage', 'teams', 'guardrails',
    'secrets', 'trust', 'usage', 'quality-results', 'edge', 'managed-devices', 'configuration',
    'backups', 'admin',
  ];
  for (const id of required) assert.ok(sidebar.some((owner) => owner.id === id), `${id} missing`);

  const contextual = CANONICAL_OWNERS.filter((owner) => owner.placement === 'contextual');
  assert.deepEqual(contextual.map((owner) => owner.id), ['clusters']);
  assert.equal(contextual[0].sidebarParent, 'nodes');
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
});

test('contextual routes highlight their declared sidebar parent and dynamic routes keep ownership', () => {
  assert.equal(sidebarActiveIdFor('clusters'), 'nodes');
  assert.equal(sidebarActiveIdFor('quality-results'), 'quality-results');
  assert.equal(sidebarActiveIdForPath('/operations/clusters/from-registry'), 'nodes');
  assert.equal(sidebarActiveIdForPath('/operations/services/langfuse'), 'services');
  assert.equal(
    sidebarActiveIdForPath('/runtime/pipelines/credit-risk/policy'),
    'runtime-pipelines',
  );
  assert.equal(sidebarActiveIdForPath('/solutions/apps/app-42/runs'), 'apps');
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
