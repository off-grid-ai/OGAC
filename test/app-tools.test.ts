import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '../src/lib/app-model.ts';
import {
  appToolRef,
  isAppToolRef,
  parseAppToolRef,
  stepAppToolRefs,
  specAppToolIds,
  buildAppToolGraph,
  detectAppToolCycles,
  wouldCreateCycle,
  reaches,
  appToolCatalog,
  setStepTools,
  stepTools,
} from '../src/lib/app-tools.ts';

// PURE unit tests for apps-as-tools resolution + cycle safety (Builder Epic #117). No I/O.

// A published app whose single inline agent step uses the given app-tool refs.
function app(id: string, uses: string[] = [], published = true): AppSpec {
  return {
    id,
    orgId: 'default',
    ownerId: 'u',
    title: `App ${id}`,
    summary: `summary ${id}`,
    visibility: 'org',
    published,
    trigger: { kind: 'on-demand' },
    steps: [
      {
        id: 's1',
        label: 'Decide',
        kind: 'agent',
        inlineAgent: { systemPrompt: 'x', grounded: true, tools: uses.map(appToolRef) },
      },
    ],
    edges: [],
  };
}

test('ref helpers: app:<id> round-trips', () => {
  assert.equal(appToolRef('a'), 'app:a');
  assert.equal(isAppToolRef('app:a'), true);
  assert.equal(isAppToolRef('prim:web_search'), false);
  assert.equal(parseAppToolRef('app:a'), 'a');
  assert.equal(parseAppToolRef('tool:a'), null);
});

test('stepAppToolRefs / specAppToolIds only extract app: refs', () => {
  const spec = app('a', ['b']);
  spec.steps[0] = {
    id: 's1',
    label: 'Decide',
    kind: 'agent',
    inlineAgent: { systemPrompt: 'x', grounded: true, tools: ['app:b', 'prim:web_search', 'tool:x'] },
  };
  assert.deepEqual(stepAppToolRefs(spec.steps[0]), ['app:b']);
  assert.deepEqual(specAppToolIds(spec), ['b']);
});

test('detectAppToolCycles: a DAG has no cycles', () => {
  const specs = [app('a', ['b']), app('b', ['c']), app('c', [])];
  assert.deepEqual(detectAppToolCycles(buildAppToolGraph(specs)), []);
});

test('detectAppToolCycles: a 2-node loop is detected', () => {
  const specs = [app('a', ['b']), app('b', ['a'])];
  const cycles = detectAppToolCycles(buildAppToolGraph(specs));
  assert.ok(cycles.length >= 1);
  assert.ok(cycles[0].includes('a') && cycles[0].includes('b'));
});

test('detectAppToolCycles: a self-loop is detected', () => {
  const specs = [app('a', ['a'])];
  const cycles = detectAppToolCycles(buildAppToolGraph(specs));
  assert.ok(cycles.length >= 1);
});

test('wouldCreateCycle: self-reference refused', () => {
  const g = buildAppToolGraph([app('a', []), app('b', [])]);
  assert.equal(wouldCreateCycle(g, 'a', 'a'), true);
});

test('wouldCreateCycle: closing a loop refused, safe add allowed', () => {
  // b already uses a. Adding a→b would close a→b→a.
  const g = buildAppToolGraph([app('a', []), app('b', ['a'])]);
  assert.equal(wouldCreateCycle(g, 'a', 'b'), true);
  // c is independent — a→c is safe.
  const g2 = buildAppToolGraph([app('a', []), app('b', []), app('c', [])]);
  assert.equal(wouldCreateCycle(g2, 'a', 'c'), false);
});

test('reaches: transitive reachability', () => {
  const g = buildAppToolGraph([app('a', ['b']), app('b', ['c']), app('c', [])]);
  assert.equal(reaches(g, 'a', 'c'), true);
  assert.equal(reaches(g, 'c', 'a'), false);
});

test('appToolCatalog: excludes self + unpublished, flags cyclic candidates', () => {
  // b uses a; a is being edited. Candidate b would create a cycle (a→b→a).
  const specs = [app('a', []), app('b', ['a']), app('c', [], false /* unpublished */)];
  const cat = appToolCatalog(specs, 'a');
  const ids = cat.map((e) => e.id).sort();
  assert.deepEqual(ids, ['b'], 'self (a) excluded, unpublished (c) excluded');
  const b = cat.find((e) => e.id === 'b')!;
  assert.equal(b.cyclic, true);
  assert.equal(b.ref, 'app:b');
});

test('appToolCatalog: new unsaved app (empty callerId) marks nothing cyclic', () => {
  const specs = [app('a', []), app('b', [])];
  const cat = appToolCatalog(specs, '');
  assert.ok(cat.every((e) => e.cyclic === false));
  assert.equal(cat.length, 2);
});

test('setStepTools / stepTools: set + read tool refs on an inline agent step', () => {
  const spec = app('a', []);
  const next = setStepTools(spec, 's1', ['app:b', 'prim:web_search']);
  assert.deepEqual(stepTools(next.steps[0]), ['app:b', 'prim:web_search']);
  // original unchanged (pure)
  assert.deepEqual(stepTools(spec.steps[0]), []);
});

test('setStepTools: no-op on a non-agent / unknown step', () => {
  const spec: AppSpec = {
    ...app('a', []),
    steps: [{ id: 's1', label: 'Out', kind: 'output', sink: 'console' }],
  };
  const next = setStepTools(spec, 's1', ['prim:web_search']);
  assert.equal(next, spec); // unchanged reference
});
