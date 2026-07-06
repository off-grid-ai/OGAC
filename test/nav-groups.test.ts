import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  NAV_GROUPS,
  groupModules,
  sidebarActiveIdFor,
  sidebarActiveIdForPath,
  sidebarSections,
} from '../src/modules/groups.ts';
import { MODULES, type ModuleId } from '../src/modules/registry.ts';

// Read a scoped nav component's source and pull out every module id it gates a tab on. The nav
// components are 'use client' React files (they import next/link, etc.), so we can't import them in
// a node test — but their tab tables are literal `gate: 'x'` / `id: 'x'` fields, so scraping the
// source is a faithful check that a real tab links to each id. Keeps this test honest against the
// ACTUAL navs instead of a hand-maintained mirror that can drift.
function navTabIds(relPath: string): Set<ModuleId> {
  const src = readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8');
  const ids = new Set<ModuleId>();
  for (const m of src.matchAll(/\b(?:gate|id):\s*'([a-z0-9-]+)'/g)) {
    ids.add(m[1] as ModuleId);
  }
  return ids;
}

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

test('Build consolidation: agents + agent-runs highlight the Studio row', () => {
  // "agent and studio should become one" (founder): Studio is the ONE build front door and the
  // sidebar primary. The old Agents roster + Agent Runs are now secondaries, so their routes keep
  // the Build → Studio sidebar row active rather than 404-ing or losing highlight. Studio maps to
  // itself (it's a primary).
  assert.equal(sidebarActiveIdFor('studio'), 'studio');
  assert.equal(sidebarActiveIdFor('agents'), 'studio');
  assert.equal(sidebarActiveIdFor('agent-runs'), 'studio');
});

test('Tools home (#121): tools + tool-catalog are Build secondaries under the Studio row', () => {
  // The three scattered tool surfaces are unified under ONE Tools home in the Build group. `tools`
  // is the new home and `tool-catalog` (the old orphaned catalog, now a redirect into Tools→Catalog)
  // both live under Build, so their routes keep the Build → Studio sidebar row lit. `tool-catalog`
  // must NO LONGER be claimed by Data.
  assert.equal(sidebarActiveIdFor('tools'), 'studio');
  assert.equal(sidebarActiveIdFor('tool-catalog'), 'studio');

  const build = NAV_GROUPS.find((g) => g.id === 'build');
  const data = NAV_GROUPS.find((g) => g.id === 'data');
  assert.ok(build?.secondary?.includes('tools'), 'tools must be a Build secondary');
  assert.ok(build?.secondary?.includes('tool-catalog'), 'tool-catalog must move to Build');
  assert.ok(!data?.secondary?.includes('tool-catalog'), 'tool-catalog must leave Data');

  // Neither is a sidebar primary (Build stays scannable: Studio + Brain only).
  const shown = new Set(sidebarSections(ALL).flatMap((s) => s.items.map((i) => i.id)));
  assert.ok(!shown.has('tools'), 'tools must not be a sidebar row');
  assert.ok(!shown.has('tool-catalog'), 'tool-catalog must not be a sidebar row');
});

test('sidebarActiveIdForPath: the builder /apps/* surfaces keep the Build → Studio row lit', () => {
  // /apps/runs, /apps/reports, and the per-app shell /apps/<id>/* have NO module of their own —
  // their pages gate on `studio` and they route under /apps. The pure path resolver aliases them to
  // the `studio` module so the Build → Studio sidebar row stays highlighted instead of the whole
  // sidebar un-lighting. `studio` is a Build primary, so it maps to itself.
  assert.equal(sidebarActiveIdForPath('/apps/runs', MODULES), 'studio');
  assert.equal(sidebarActiveIdForPath('/apps/runs/run_123', MODULES), 'studio');
  assert.equal(sidebarActiveIdForPath('/apps/reports', MODULES), 'studio');
  assert.equal(sidebarActiveIdForPath('/apps/app_42', MODULES), 'studio');
  assert.equal(sidebarActiveIdForPath('/apps/app_42/runs', MODULES), 'studio');
});

test('sidebarActiveIdForPath: a real module route resolves via its group landing', () => {
  // Falls through the alias table to longest-matching module route, then to the group primary.
  assert.equal(sidebarActiveIdForPath('/studio', MODULES), 'studio'); // studio primary → itself
  assert.equal(sidebarActiveIdForPath('/agent-runs', MODULES), 'studio'); // secondary → Studio
  assert.equal(sidebarActiveIdForPath('/policy', MODULES), 'control'); // secondary → Governance
  assert.equal(sidebarActiveIdForPath('/agents', MODULES), 'studio'); // secondary → Studio
});

test('sidebarActiveIdForPath: an unmatched path lights nothing', () => {
  assert.equal(sidebarActiveIdForPath('/nowhere', MODULES), undefined);
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

test('every secondary module id is REACHABLE — a scoped-nav tab links it, or it is a documented exception (task #132)', () => {
  // A secondary keeps its route (nothing 404s) but is hidden from the sidebar — so the ONLY way to
  // it is a tab in its group's scoped in-page nav. A secondary with no tab is URL-only / orphaned:
  // the founder couldn't find Evals for exactly this reason. This test locks the invariant so it
  // can't regress: for each group, every secondary either has a tab in the matching nav component,
  // or is listed as an intentional exception below (reached from a DIFFERENT surface, by design).

  // group id → the scoped nav that renders that group's secondary tabs.
  const NAV_BY_GROUP: Record<string, string> = {
    build: 'src/components/build/BuildNav.tsx',
    data: 'src/components/data/DataNav.tsx',
    insights: 'src/components/insights/InsightsNav.tsx',
    governance: 'src/components/governance/GovernanceNav.tsx',
  };

  // Secondaries deliberately reached somewhere OTHER than their group's scoped nav. Each is a design
  // decision, not an oversight — documented here so an intentional exception never looks like a gap.
  const EXCEPTIONS: Partial<Record<ModuleId, string>> = {
    // Workspace group has no scoped-nav file in this test's scope; these are Chat sub-surfaces
    // reached from WorkspaceNav's top-tabs / the chat project switcher (see (workspace)/layout.tsx).
    projects: 'reached from WorkspaceNav / chat project switcher',
    prompts: 'reached from WorkspaceNav top-tabs',
    artifacts: 'reached from WorkspaceNav top-tabs',
    // "agent and studio should become one" — the Studio tab IS the agents home (an agent is a
    // 1-step app); the /agents roster route still resolves and highlights the Studio row.
    agents: 'subsumed into the Studio tab (ONE build front door)',
    // The old standalone tool-catalog route now redirects into Tools→Catalog (the Tools tab).
    'tool-catalog': 'redirects into the Tools tab (#121)',
    // The Caddy edge is an internal detail of the published surface, reached under Services.
    edge: 'reached under Services',
  };

  const orphans: string[] = [];
  for (const g of NAV_GROUPS) {
    const secondaries = g.secondary ?? [];
    if (secondaries.length === 0) continue;
    const navPath = NAV_BY_GROUP[g.id];
    const tabIds = navPath ? navTabIds(navPath) : new Set<ModuleId>();
    for (const id of secondaries) {
      if (tabIds.has(id)) continue; // a real tab links it
      if (id in EXCEPTIONS) continue; // documented, reached elsewhere by design
      orphans.push(`${g.id} → ${id}`);
    }
  }
  assert.deepEqual(orphans, [], `orphaned secondaries (no tab, no documented exception): ${orphans.join(', ')}`);
});

test('Build Test tab: evals/sandbox/provit are reachable via BuildNav (the #132 headline fix)', () => {
  // Evals was a real page listed as a Build secondary but linked by no nav — URL-only. It now has a
  // tab, alongside Sandbox and Visual QA (provit), which were orphaned the same way.
  const buildTabs = navTabIds('src/components/build/BuildNav.tsx');
  for (const id of ['evals', 'sandbox', 'provit'] as const) {
    assert.ok(buildTabs.has(id), `${id} must have a tab in BuildNav`);
  }
});

test('unclaimed module falls into "More" for both views', () => {
  const fake = [{ id: 'chat' as ModuleId }, { id: '__ghost__' as ModuleId }];
  for (const fn of [sidebarSections, groupModules]) {
    const more = fn(fake).find((s) => s.label === 'More');
    assert.ok(more, `${fn.name} dropped the unclaimed module`);
    assert.deepEqual(more?.items, [{ id: '__ghost__' }]);
  }
});
