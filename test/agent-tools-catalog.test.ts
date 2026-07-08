import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAgentToolCatalog,
  isAutonomousAgent,
} from '../src/lib/agent-tools-catalog.ts';
import { PRIMITIVE_EGRESS_ENV, WEB_SEARCH_ENV } from '../src/lib/tool-primitives.ts';

// PURE unit tests for the agent tools catalog (Agentic Epic). No I/O — registry/app descriptors are
// passed in as plain data, primitives resolved from the real pure catalog.

test('capability tags (retrieval/summarize) are NOT exposed as loop tools', () => {
  const catalog = buildAgentToolCatalog({ refs: ['retrieval', 'summarize', 'ocr'] });
  assert.deepEqual(catalog, []);
  assert.equal(isAutonomousAgent(catalog), false);
});

test('AIR-GAP: an internet primitive is DROPPED with no opt-in env (planner never sees it)', () => {
  const catalog = buildAgentToolCatalog({ refs: ['prim:web_search'], env: {} });
  assert.deepEqual(catalog, [], 'web_search is off by default — not exposed');
  assert.equal(isAutonomousAgent(catalog), false);
});

test('AIR-GAP: opting in via env exposes the primitive with its ref/name/params', () => {
  const catalog = buildAgentToolCatalog({
    refs: ['prim:web_search'],
    env: { [WEB_SEARCH_ENV]: '1' },
  });
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].ref, 'prim:web_search');
  assert.equal(catalog[0].name, 'Web search');
  assert.deepEqual(catalog[0].paramKeys, ['query', 'count']);
  assert.equal(isAutonomousAgent(catalog), true);
});

test('master egress flag exposes every declared internet primitive', () => {
  const catalog = buildAgentToolCatalog({
    refs: ['prim:web_search', 'prim:read_url', 'prim:http_fetch'],
    env: { [PRIMITIVE_EGRESS_ENV]: 'true' },
  });
  assert.deepEqual(
    catalog.map((t) => t.ref).sort(),
    ['prim:http_fetch', 'prim:read_url', 'prim:web_search'],
  );
});

test('registry (tool:<id>) + app (app:<id>) refs are exposed only when a descriptor is supplied', () => {
  const catalog = buildAgentToolCatalog({
    refs: ['tool:sql-runner', 'app:report-builder', 'app:unresolved'],
    registryTools: [{ ref: 'tool:sql-runner', name: 'SQL Runner', description: 'runs SQL' }],
    appTools: [{ ref: 'app:report-builder', name: 'Report Builder', description: 'builds reports' }],
  });
  assert.deepEqual(catalog.map((t) => t.ref), ['tool:sql-runner', 'app:report-builder']);
  // An app ref with no descriptor (unpublished / not in org) is not exposed.
  assert.ok(!catalog.some((t) => t.ref === 'app:unresolved'));
  // App tools default to a `query` arg.
  assert.deepEqual(catalog.find((t) => t.ref === 'app:report-builder')?.paramKeys, ['query']);
});

test('duplicate refs de-dupe, declaration order preserved', () => {
  const catalog = buildAgentToolCatalog({
    refs: ['prim:web_search', 'prim:web_search', 'prim:read_url'],
    env: { [PRIMITIVE_EGRESS_ENV]: '1' },
  });
  assert.deepEqual(catalog.map((t) => t.ref), ['prim:web_search', 'prim:read_url']);
});
