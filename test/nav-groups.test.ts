import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NAV_GROUPS,
  groupModules,
  sidebarActiveIdFor,
  sidebarSections,
} from '../src/modules/groups.ts';
import { MODULES, type ModuleId } from '../src/modules/registry.ts';

// Unit tests for the pure sidebar-grouping logic — no React, no router, no I/O. This is the
// decision that keeps the sidebar at ~20 scannable rows (primaries only) while every module still
// resolves at its route (secondaries reached via section landings). A regression here reintroduces
// the flat 40-item sidebar the IA refactor removed.

const ALL = MODULES.map((m) => ({ id: m.id }));

test('sidebarSections stays scannable — ~20 rows, no group over 5 items', () => {
  const sections = sidebarSections(ALL);
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  assert.ok(total >= 15 && total <= 22, `expected ~20 sidebar rows, got ${total}`);
  for (const s of sections) {
    assert.ok(s.items.length <= 5, `group "${s.label}" has ${s.items.length} rows (>5)`);
  }
});

test('sidebarSections shows only primaries; secondaries are hidden from the sidebar', () => {
  const shown = new Set(sidebarSections(ALL).flatMap((s) => s.items.map((i) => i.id)));
  const primaries = new Set(NAV_GROUPS.flatMap((g) => g.primary));
  const secondaries = new Set(NAV_GROUPS.flatMap((g) => g.secondary ?? []));

  for (const id of primaries) assert.ok(shown.has(id), `primary ${id} missing from sidebar`);
  for (const id of secondaries) assert.ok(!shown.has(id), `secondary ${id} leaked into sidebar`);
});

test('every enabled module is reachable — primary, secondary, or trailing "More"', () => {
  // groupModules covers primary+secondary; anything unclaimed lands in "More". Between the two, no
  // module may vanish from navigation.
  const grouped = new Set(groupModules(ALL).flatMap((s) => s.items.map((i) => i.id)));
  for (const m of MODULES) assert.ok(grouped.has(m.id), `module ${m.id} unreachable in nav`);
});

test('no module is claimed by two groups', () => {
  const seen = new Set<ModuleId>();
  for (const g of NAV_GROUPS) {
    for (const id of [...g.primary, ...(g.secondary ?? [])]) {
      assert.ok(!seen.has(id), `module ${id} claimed by more than one group`);
      seen.add(id);
    }
  }
});

test('sidebarActiveIdFor: a secondary route highlights its group primary', () => {
  // /policy (secondary) → Control (Governance primary); /accounting → observability; /edge → services.
  assert.equal(sidebarActiveIdFor('policy'), 'control');
  assert.equal(sidebarActiveIdFor('accounting'), 'observability');
  assert.equal(sidebarActiveIdFor('edge'), 'services');
  assert.equal(sidebarActiveIdFor('integrations'), 'data');
});

test('Workspace consolidation: projects/prompts/artifacts are chat sub-surfaces, not sidebar rows', () => {
  // The founder brief: a project IS a chat context; Chat is the Workspace front door and
  // Projects/Prompts/Artifacts are reached from its top-tabs, so they highlight the Chat row and
  // never appear as their own sidebar entries.
  for (const id of ['projects', 'prompts', 'artifacts'] as const) {
    assert.equal(sidebarActiveIdFor(id), 'chat', `${id} should highlight the Chat row`);
  }
  const shown = new Set(sidebarSections(ALL).flatMap((s) => s.items.map((i) => i.id)));
  assert.ok(shown.has('chat'), 'Chat must be a sidebar row');
  for (const id of ['projects', 'prompts', 'artifacts'] as const) {
    assert.ok(!shown.has(id), `${id} must not be a sidebar row`);
  }
});

test('Build consolidation: studio + agent-runs highlight the Agents row', () => {
  // Studio and Agents were consolidated under one "Agents" umbrella (BuildNav tabs across
  // Agents / Studio / Runs). Studio and Agent Runs are now secondaries, so their routes must keep
  // the Build → Agents sidebar row active rather than 404-ing or losing highlight.
  assert.equal(sidebarActiveIdFor('studio'), 'agents');
  assert.equal(sidebarActiveIdFor('agent-runs'), 'agents');
});

test('sidebarActiveIdFor: a primary maps to itself', () => {
  assert.equal(sidebarActiveIdFor('chat'), 'chat');
  assert.equal(sidebarActiveIdFor('overview'), 'overview');
  assert.equal(sidebarActiveIdFor('control'), 'control');
});

test('groupModules preserves the existing behavior (full membership + More fallback)', () => {
  const sections = groupModules([{ id: 'chat' }, { id: 'policy' }, { id: 'overview' }]);
  const home = sections.find((s) => s.label === 'Home');
  const gov = sections.find((s) => s.label === 'Governance');
  assert.deepEqual(home?.items, [{ id: 'overview' }]);
  assert.deepEqual(gov?.items, [{ id: 'policy' }]); // secondary still grouped under its section
});

test('unclaimed module falls into "More" for both views', () => {
  const fake = [{ id: 'chat' as ModuleId }, { id: '__ghost__' as ModuleId }];
  for (const fn of [sidebarSections, groupModules]) {
    const more = fn(fake).find((s) => s.label === 'More');
    assert.ok(more, `${fn.name} dropped the unclaimed module`);
    assert.deepEqual(more?.items, [{ id: '__ghost__' }]);
  }
});
