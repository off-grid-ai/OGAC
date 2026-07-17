import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NAV_GROUPS,
  groupModules,
  sidebarActiveIdFor,
  sidebarActiveIdForPath,
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

test('sidebar is derived from explicit primaries and never invents a More group', () => {
  const sections = sidebarSections(MODULES);
  assert.ok(sections.every((section) => section.label !== 'More'));
  assert.deepEqual(
    sections.map((section) => section.id),
    NAV_GROUPS.map((group) => group.id),
  );
  for (const section of sections) {
    assert.ok(section.items.length <= 4, `${section.label} has too many primary rows`);
    assert.ok(section.items.every((item) => item.primary));
  }
});

test('all canonical owners remain reachable through sidebar or scoped navigation', () => {
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

test('secondary routes highlight their section primary and dynamic routes keep ownership', () => {
  assert.equal(sidebarActiveIdFor('clusters'), 'runs');
  assert.equal(sidebarActiveIdFor('quality-results'), 'outcomes');
  assert.equal(sidebarActiveIdForPath('/operations/clusters/from-registry'), 'runs');
  assert.equal(sidebarActiveIdForPath('/operations/services/langfuse'), 'services');
  assert.equal(
    sidebarActiveIdForPath('/runtime/pipelines/credit-risk/policy'),
    'runtime-pipelines',
  );
  assert.equal(sidebarActiveIdForPath('/solutions/apps/app-42/runs'), 'apps');
  assert.equal(sidebarActiveIdForPath('/nowhere'), undefined);
});
