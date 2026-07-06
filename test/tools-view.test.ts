import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_TOOLS_TAB,
  TOOLS_TABS,
  filterCatalog,
  matchesCatalogQuery,
  normalizeToolsTab,
} from '../src/lib/tools-view.ts';

// Pure unit tests for the Tools-home view model (#121) — no React, no I/O. Guards the tab vocabulary
// (deep-link safety) and the catalog search/filter predicate that narrows the 18-server catalog.

test('normalizeToolsTab: known tabs pass through, everything else defaults to Registered', () => {
  for (const t of TOOLS_TABS) assert.equal(normalizeToolsTab(t), t);
  assert.equal(normalizeToolsTab(undefined), DEFAULT_TOOLS_TAB);
  assert.equal(normalizeToolsTab(null), DEFAULT_TOOLS_TAB);
  assert.equal(normalizeToolsTab('bogus'), DEFAULT_TOOLS_TAB);
  assert.equal(DEFAULT_TOOLS_TAB, 'registered');
});

const SERVERS = [
  { name: 'PostgreSQL', description: 'Run read-only SQL against Postgres.', category: 'Data & DB' },
  { name: 'Brave Search', description: 'Search the public web.', category: 'Search' },
  { name: 'Filesystem', description: 'Read and write files you allow.', category: 'Filesystem & Dev' },
];

test('matchesCatalogQuery: empty query + no category matches everything', () => {
  for (const s of SERVERS) assert.ok(matchesCatalogQuery(s, '', null));
});

test('matchesCatalogQuery: query matches name / description / category, case-insensitive', () => {
  assert.ok(matchesCatalogQuery(SERVERS[0], 'postgres', null)); // name
  assert.ok(matchesCatalogQuery(SERVERS[0], 'SQL', null)); // description
  assert.ok(matchesCatalogQuery(SERVERS[0], 'data', null)); // category
  assert.ok(!matchesCatalogQuery(SERVERS[0], 'slack', null));
});

test('matchesCatalogQuery: category filter gates before the text query', () => {
  assert.ok(matchesCatalogQuery(SERVERS[1], '', 'Search'));
  assert.ok(!matchesCatalogQuery(SERVERS[1], '', 'Data & DB'));
  // Category AND query both apply.
  assert.ok(matchesCatalogQuery(SERVERS[1], 'web', 'Search'));
  assert.ok(!matchesCatalogQuery(SERVERS[1], 'web', 'Data & DB'));
});

test('filterCatalog: applies the predicate across the list', () => {
  assert.deepEqual(
    filterCatalog(SERVERS, 'search', null).map((s) => s.name),
    ['Brave Search'],
  );
  assert.equal(filterCatalog(SERVERS, '', 'Filesystem & Dev').length, 1);
  assert.equal(filterCatalog(SERVERS, 'nothing-matches', null).length, 0);
  assert.equal(filterCatalog(SERVERS, '', null).length, SERVERS.length);
});
