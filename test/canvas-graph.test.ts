import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type AppSpec, validateAppSpec } from '../src/lib/app-model.ts';
import { addStep, moveStep, rebindDomain, removeStep } from '../src/lib/app-builder.ts';
import {
  KIND_COLOR,
  NODE_GAP,
  NODE_TOP,
  NODE_X,
  describeBinding,
  emptySpec,
  graphSummary,
  isStepIncomplete,
  specToGraph,
  stepById,
} from '../src/lib/canvas-graph.ts';

// PURE unit tests for the Phase 3B canvas ↔ AppSpec mapping — no React-Flow, no DOM, no I/O. They
// pin the invariant the whole feature rests on: a canvas node IS an AppStep (1:1 by id), a canvas
// edge IS an AppEdge, and the graph re-derives correctly after each app-builder reducer edit (so the
// canvas can never drift from the text builder, which edits the same spec via the same reducers).

// The canonical compiled skeleton: connector-query → agent → output (reimbursement-shaped).
function threeStepApp(over: Partial<AppSpec> = {}): AppSpec {
  return {
    id: 'app_1',
    orgId: 'default',
    ownerId: 'u@x',
    title: 'Reimbursement approval',
    summary: 'read invoices, decide, output',
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps: [
      { id: 's1', label: 'Read invoices', kind: 'connector-query', domain: 'dom_invoices', op: 'read' },
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

test('specToGraph: one node per step (id === step id) and one edge per AppEdge', () => {
  const spec = threeStepApp();
  const g = specToGraph(spec);
  assert.deepEqual(
    g.nodes.map((n) => n.id),
    ['s1', 's2', 's3'],
  );
  // The node id IS the step id, and data.stepId round-trips.
  for (const n of g.nodes) assert.equal(n.id, n.data.stepId);
  // One edge per AppEdge, endpoints preserved as source/target.
  assert.equal(g.edges.length, 2);
  assert.equal(g.edges[0].source, 's1');
  assert.equal(g.edges[0].target, 's2');
  assert.equal(g.edges[1].source, 's2');
  assert.equal(g.edges[1].target, 's3');
});

test('specToGraph: nodes are laid out in a vertical column at the fixed geometry', () => {
  const g = specToGraph(threeStepApp());
  g.nodes.forEach((n, i) => {
    assert.equal(n.position.x, NODE_X);
    assert.equal(n.position.y, NODE_TOP + i * NODE_GAP);
  });
});

test('specToGraph: node color + index reflect the step kind and order', () => {
  const g = specToGraph(threeStepApp());
  assert.equal(g.nodes[0].data.kind, 'connector-query');
  assert.equal(g.nodes[0].data.color, KIND_COLOR['connector-query']);
  assert.equal(g.nodes[1].data.color, KIND_COLOR['agent']);
  assert.equal(g.nodes[2].data.color, KIND_COLOR['output']);
  assert.deepEqual(
    g.nodes.map((n) => n.data.index),
    [1, 2, 3],
  );
});

test('describeBinding: resolves domain + agent NAMES from the lookups', () => {
  const spec = threeStepApp();
  const look = {
    domains: [{ id: 'dom_invoices', label: 'CoreBank invoices' }],
    agents: [{ id: 'ag_1', name: 'FNOL agent' }],
  };
  assert.equal(describeBinding(spec.steps[0], look), 'CoreBank invoices · read');
  // An agentId reference shows the resolved name.
  const agentRef: AppSpec['steps'][number] = { id: 'x', label: 'x', kind: 'agent', agentId: 'ag_1' };
  assert.equal(describeBinding(agentRef, look), 'FNOL agent');
});

test('describeBinding: unbound connector-query + promptless agent read as needing attention', () => {
  const unboundConn: AppSpec['steps'][number] = { id: 'c', label: 'c', kind: 'connector-query', domain: '' };
  assert.equal(describeBinding(unboundConn), 'pick a data domain');
  const emptyAgent: AppSpec['steps'][number] = {
    id: 'a',
    label: 'a',
    kind: 'agent',
    inlineAgent: { systemPrompt: '', grounded: true },
  };
  assert.equal(describeBinding(emptyAgent), 'needs instructions');
});

test('isStepIncomplete: flags exactly the steps validateAppSpec would reject on shape', () => {
  assert.equal(isStepIncomplete({ id: 'c', label: 'c', kind: 'connector-query', domain: '' }), true);
  assert.equal(
    isStepIncomplete({ id: 'c', label: 'c', kind: 'connector-query', domain: 'dom_x' }),
    false,
  );
  assert.equal(
    isStepIncomplete({ id: 'a', label: 'a', kind: 'agent', inlineAgent: { systemPrompt: '', grounded: true } }),
    true,
  );
  assert.equal(isStepIncomplete({ id: 'a', label: 'a', kind: 'agent', agentId: 'ag_1' }), false);
  assert.equal(isStepIncomplete({ id: 'h', label: 'h', kind: 'human' }), false);
});

test('graph re-derives correctly after app-builder edits (canvas === text, one spec)', () => {
  let spec = threeStepApp();

  // Add a guardrail step (append) — the reducer rechains edges; the graph must reflect it.
  spec = addStep(spec, 'guardrail');
  let g = specToGraph(spec);
  assert.equal(g.nodes.length, 4);
  // Edges stay a linear chain over the new order (rechained by the reducer, not this module).
  assert.equal(g.edges.length, 3);
  assert.equal(g.edges[g.edges.length - 1].target, spec.steps[3].id);

  // Move the guardrail up one — order changes, node y-positions follow the array order.
  const gid = spec.steps[3].id;
  spec = moveStep(spec, gid, -1);
  g = specToGraph(spec);
  assert.equal(g.nodes[2].id, gid);
  assert.equal(g.nodes[2].position.y, NODE_TOP + 2 * NODE_GAP);

  // Remove it — back to 3 nodes / 2 edges.
  spec = removeStep(spec, gid);
  g = specToGraph(spec);
  assert.equal(g.nodes.length, 3);
  assert.equal(g.edges.length, 2);

  // Rebind the connector-query's domain — the node's binding line + incompleteness update.
  spec = rebindDomain(spec, 's1', 'dom_new');
  g = specToGraph(spec, { domains: [{ id: 'dom_new', label: 'New source' }] });
  assert.equal(g.nodes[0].data.binding, 'New source · read');
  assert.equal(g.nodes[0].data.incomplete, false);

  // The whole spec stays a valid one-entry graph the executor can run.
  assert.equal(validateAppSpec(spec).ok, true);
});

test('stepById: locates the AppStep a node id refers to', () => {
  const spec = threeStepApp();
  assert.equal(stepById(spec, 's2')?.kind, 'agent');
  assert.equal(stepById(spec, 'nope'), undefined);
});

test('graphSummary: counts steps/edges/kinds + human + incomplete', () => {
  const spec = threeStepApp({
    steps: [
      { id: 's1', label: 'Read', kind: 'connector-query', domain: '' }, // incomplete
      { id: 's2', label: 'Decide', kind: 'agent', inlineAgent: { systemPrompt: 'x', grounded: true } },
      { id: 's3', label: 'Review', kind: 'human' },
      { id: 's4', label: 'Out', kind: 'output', sink: 'console' },
    ],
    edges: [
      { from: 's1', to: 's2' },
      { from: 's2', to: 's3' },
      { from: 's3', to: 's4' },
    ],
  });
  const s = graphSummary(spec);
  assert.equal(s.stepCount, 4);
  assert.equal(s.edgeCount, 3);
  assert.equal(s.hasHuman, true);
  assert.equal(s.incompleteCount, 1);
  assert.equal(s.kinds['connector-query'], 1);
  assert.equal(s.kinds.agent, 1);
});

test('emptySpec: a single-agent app is a valid starting point (the simplest app)', () => {
  const spec = emptySpec();
  const g = specToGraph(spec);
  assert.equal(g.nodes.length, 1);
  assert.equal(g.edges.length, 0);
  assert.equal(g.nodes[0].data.kind, 'agent');
  // One empty-prompt agent is structurally a one-entry graph, but flagged incomplete (needs a prompt).
  assert.equal(g.nodes[0].data.incomplete, true);
});
