import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type AppSpec, validateAppSpec } from '../src/lib/app-model.ts';
import {
  addEdge,
  addStepNoRechain,
  removeEdge,
  removeStepAndEdges,
  wouldCreateStepCycle,
} from '../src/lib/app-builder.ts';

// PURE unit tests for the VISUAL CANVAS topology reducers (Builder Epic — branching editor). They
// pin that the operator can draw/delete edges and add/remove nodes so a workflow can BRANCH/rewire,
// while every op stays cycle-safe and never fabricates a dangling edge. No DB, no React-Flow, no I/O.

// A 3-step linear reimbursement-shaped app: s1 → s2 → s3.
function linear3(over: Partial<AppSpec> = {}): AppSpec {
  return {
    id: 'app_1',
    orgId: 'default',
    ownerId: 'u@x',
    title: 'Reimbursement approval',
    summary: 'read, decide, output',
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps: [
      { id: 's1', label: 'Read invoices', kind: 'connector-query', domain: 'dom_inv', op: 'read' },
      { id: 's2', label: 'Decide', kind: 'agent', inlineAgent: { systemPrompt: 'decide', grounded: true } },
      { id: 's3', label: 'Output', kind: 'output', sink: 'console' },
    ],
    edges: [
      { from: 's1', to: 's2' },
      { from: 's2', to: 's3' },
    ],
    ...over,
  };
}

// ─── addEdge ──────────────────────────────────────────────────────────────────────────────────────

test('addEdge draws a branch and keeps the spec valid', () => {
  // Add a 4th step (a guardrail) disconnected, then wire s1 → s4 → s3 as a parallel branch.
  const { spec: withNode, id } = addStepNoRechain(linear3(), 'guardrail');
  assert.equal(id, 's4');
  const branched = addEdge(addEdge(withNode, 's1', 's4'), 's4', 's3');
  assert.equal(branched.edges.length, 4);
  assert.ok(branched.edges.some((e) => e.from === 's1' && e.to === 's4'));
  assert.ok(branched.edges.some((e) => e.from === 's4' && e.to === 's3'));
  // Multiple entries? No — s1 is still the sole entry; every node reachable from it.
  assert.equal(validateAppSpec(branched).ok, true);
});

test('addEdge is a NO-OP on a self-loop', () => {
  const spec = linear3();
  const out = addEdge(spec, 's2', 's2');
  assert.equal(out, spec); // same object identity — rejected
});

test('addEdge is a NO-OP on a duplicate edge', () => {
  const spec = linear3();
  const out = addEdge(spec, 's1', 's2'); // already exists
  assert.equal(out, spec);
});

test('addEdge is a NO-OP when an endpoint is not a real step', () => {
  const spec = linear3();
  assert.equal(addEdge(spec, 's1', 'nope'), spec);
  assert.equal(addEdge(spec, 'nope', 's2'), spec);
});

test('addEdge REFUSES an edge that would create a cycle', () => {
  const spec = linear3(); // s1→s2→s3
  // s3→s1 would close s1→s2→s3→s1.
  const out = addEdge(spec, 's3', 's1');
  assert.equal(out, spec); // rejected, no cycle introduced
  // A direct back-edge s2→s1 also loops.
  assert.equal(addEdge(spec, 's2', 's1'), spec);
});

// ─── removeEdge ─────────────────────────────────────────────────────────────────────────────────

test('removeEdge deletes exactly the named edge', () => {
  const spec = linear3();
  const out = removeEdge(spec, 's1', 's2');
  assert.equal(out.edges.length, 1);
  assert.deepEqual(out.edges, [{ from: 's2', to: 's3' }]);
});

test('removeEdge is a NO-OP when the edge is absent', () => {
  const spec = linear3();
  assert.equal(removeEdge(spec, 's1', 's3'), spec);
});

// ─── addStepNoRechain / removeStepAndEdges ──────────────────────────────────────────────────────

test('addStepNoRechain appends a disconnected node WITHOUT rechaining', () => {
  const spec = linear3();
  const { spec: out, id } = addStepNoRechain(spec, 'human');
  assert.equal(out.steps.length, 4);
  assert.equal(id, 's4');
  // Edges untouched — the new node is disconnected until the operator draws to it.
  assert.deepEqual(out.edges, spec.edges);
});

test('removeStepAndEdges drops the node and only its edges, preserving branches', () => {
  // Build a diamond: s1→s2, s1→s4, s2→s3, s4→s3.
  const { spec: withNode } = addStepNoRechain(linear3(), 'guardrail'); // s4
  let spec = addEdge(withNode, 's1', 's4');
  spec = addEdge(spec, 's4', 's3');
  // Remove s4 → both s1→s4 and s4→s3 vanish; s1→s2→s3 survives intact.
  const out = removeStepAndEdges(spec, 's4');
  assert.equal(out.steps.length, 3);
  assert.ok(!out.edges.some((e) => e.from === 's4' || e.to === 's4'));
  assert.ok(out.edges.some((e) => e.from === 's1' && e.to === 's2'));
  assert.ok(out.edges.some((e) => e.from === 's2' && e.to === 's3'));
  assert.equal(validateAppSpec(out).ok, true);
});

test('removeStepAndEdges never removes the last remaining step', () => {
  const one: AppSpec = linear3({ steps: [{ id: 's1', label: 'only', kind: 'output', sink: 'console' }], edges: [] });
  assert.equal(removeStepAndEdges(one, 's1'), one);
});

test('removeStepAndEdges is a NO-OP for an unknown id', () => {
  const spec = linear3();
  assert.equal(removeStepAndEdges(spec, 'nope'), spec);
});

// ─── wouldCreateStepCycle (the pure guard) ──────────────────────────────────────────────────────

test('wouldCreateStepCycle detects direct + transitive loops and self-refs', () => {
  const edges = [
    { from: 's1', to: 's2' },
    { from: 's2', to: 's3' },
  ];
  assert.equal(wouldCreateStepCycle(edges, 's1', 's1'), true); // self
  assert.equal(wouldCreateStepCycle(edges, 's3', 's1'), true); // transitive back-edge
  assert.equal(wouldCreateStepCycle(edges, 's2', 's1'), true); // direct back-edge
  assert.equal(wouldCreateStepCycle(edges, 's1', 's3'), false); // forward shortcut is fine (DAG)
});
