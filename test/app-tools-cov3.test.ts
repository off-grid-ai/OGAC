import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '../src/lib/app-model.ts';
import {
  appToolCatalog,
  setStepTools,
  stepTools,
  reaches,
  wouldCreateCycle,
  buildAppToolGraph,
} from '../src/lib/app-tools.ts';

// Branch top-up for app-tools.ts — targets appToolCatalog's "caller not yet saved" arm (172-173),
// setStepTools no-op path, and stepTools/wouldCreateCycle both arms.

function app(id: string, over: Partial<AppSpec> = {}): AppSpec {
  return {
    id,
    orgId: 'default',
    ownerId: 'u',
    title: id,
    summary: '',
    visibility: 'private',
    published: true,
    trigger: { kind: 'on-demand' },
    steps: [{ id: 's1', label: 'a', kind: 'agent', inlineAgent: { systemPrompt: 'x' } }],
    edges: [],
    ...over,
  };
}

test('appToolCatalog seeds an unsaved caller (not in specs) into the graph', () => {
  const specs = [app('a'), app('b')];
  // callerId "new" is NOT among specs → the 171-173 seeding branch runs.
  const cat = appToolCatalog(specs, 'new');
  assert.equal(cat.length, 2);
  assert.ok(cat.every((c) => c.cyclic === false));
  assert.deepEqual(cat.map((c) => c.ref).sort(), ['app:a', 'app:b']);
});

test('appToolCatalog empty callerId marks nothing cyclic and includes all published apps', () => {
  const cat = appToolCatalog([app('a'), app('b', { published: false })], '');
  // only published apps
  assert.deepEqual(cat.map((c) => c.id), ['a']);
  assert.equal(cat[0].cyclic, false);
  assert.equal(cat[0].description, 'A published app.');
});

test('appToolCatalog flags a callee that would create a cycle', () => {
  // b already uses a → offering a→b to caller "a" is cyclic.
  const b = app('b', {
    steps: [{ id: 's1', label: 'a', kind: 'agent', inlineAgent: { systemPrompt: 'x', tools: ['app:a'] } }],
  });
  const cat = appToolCatalog([app('a'), b], 'a');
  const entryB = cat.find((c) => c.id === 'b')!;
  assert.equal(entryB.cyclic, true);
});

test('appToolCatalog uses the app summary as description when present', () => {
  const cat = appToolCatalog([app('a', { summary: 'a helpful app' })], 'x');
  assert.equal(cat[0].description, 'a helpful app');
});

test('setStepTools sets tools on an inline agent step; no-op on unknown/non-agent step', () => {
  const spec = app('a');
  const updated = setStepTools(spec, 's1', ['tool:x', 'app:b']);
  assert.deepEqual((updated.steps[0] as { inlineAgent?: { tools?: string[] } }).inlineAgent?.tools, ['tool:x', 'app:b']);

  // Unknown step id → returns the SAME object (changed=false).
  const noop = setStepTools(spec, 'missing', ['tool:y']);
  assert.equal(noop, spec);
});

test('setStepTools creates an inlineAgent when the step had none', () => {
  const spec = app('a', { steps: [{ id: 's1', label: 'a', kind: 'agent', agentId: 'agentref' }] });
  const updated = setStepTools(spec, 's1', ['prim:web_search']);
  assert.deepEqual((updated.steps[0] as { inlineAgent?: { tools?: string[] } }).inlineAgent?.tools, ['prim:web_search']);
});

test('stepTools returns tools for an agent step and [] for non-agent', () => {
  assert.deepEqual(stepTools({ id: 's', label: 'l', kind: 'agent', inlineAgent: { systemPrompt: 'x', tools: ['tool:z'] } }), ['tool:z']);
  assert.deepEqual(stepTools({ id: 's', label: 'l', kind: 'agent', inlineAgent: { systemPrompt: 'x' } }), []);
  assert.deepEqual(stepTools({ id: 's', label: 'l', kind: 'output', sink: 'console' }), []);
});

test('reaches / wouldCreateCycle both arms', () => {
  const graph = buildAppToolGraph([
    app('a', { steps: [{ id: 's', label: 'l', kind: 'agent', inlineAgent: { systemPrompt: 'x', tools: ['app:b'] } }] }),
    app('b'),
  ]);
  assert.equal(reaches(graph, 'a', 'b'), true);
  assert.equal(reaches(graph, 'b', 'a'), false);
  assert.equal(wouldCreateCycle(graph, 'a', 'a'), true); // self-ref
  assert.equal(wouldCreateCycle(graph, 'a', 'b'), false); // a already reaches b, adding a->b again isn't a NEW cycle back to a
  assert.equal(wouldCreateCycle(graph, 'b', 'a'), true); // a reaches b, so b->a closes a loop
});
