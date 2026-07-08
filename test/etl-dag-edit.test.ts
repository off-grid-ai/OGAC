import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultDag, validateDagSpec, type EtlDagSpec } from '../src/lib/etl-job.ts';
import {
  addNode,
  connectNodes,
  disconnectNodes,
  mintNodeId,
  moveNode,
  relabelNode,
  removeNode,
  setTrigger,
  updateNodeConfig,
} from '../src/lib/etl-dag-edit.ts';

// PURE unit tests for the visual-builder DAG reducers. No React, no IO. Each proves the transform is
// immutable (returns a new spec) and correct — mirrors app-builder.ts's reducer tests.

test('mintNodeId: unique within the spec', () => {
  const s = defaultDag();
  const id = mintNodeId(s, 'filter');
  assert.equal(id, 'filter_1');
  const s2: EtlDagSpec = { ...s, nodes: [...s.nodes, { id: 'filter_1', kind: 'filter', config: {} }] };
  assert.equal(mintNodeId(s2, 'filter'), 'filter_2');
});

test('addNode: appends a transform node + returns its id, immutably', () => {
  const s = defaultDag();
  const before = s.nodes.length;
  const { spec, id } = addNode(s, 'redact');
  assert.equal(spec.nodes.length, before + 1);
  assert.equal(s.nodes.length, before, 'original spec unchanged');
  const added = spec.nodes.find((n) => n.id === id)!;
  assert.equal(added.kind, 'redact');
  assert.equal(added.config.action, 'mask'); // sensible default
});

test('removeNode: drops the node and its edges', () => {
  let s = defaultDag();
  const { spec, id } = addNode(s, 'filter');
  s = connectNodes(spec, 'source', id);
  s = connectNodes(s, id, 'destination');
  assert.equal(s.edges.length, 3); // source->dest (default) + the two new
  const pruned = removeNode(s, id);
  assert.ok(!pruned.nodes.some((n) => n.id === id));
  assert.ok(!pruned.edges.some((e) => e.from === id || e.to === id));
});

test('updateNodeConfig: shallow-merges the patch immutably', () => {
  const s = defaultDag();
  const next = updateNodeConfig(s, 'source', { connectorId: 'c1', resource: 'customers' });
  const src = next.nodes.find((n) => n.id === 'source')!;
  assert.equal(src.config.connectorId, 'c1');
  assert.equal(src.config.resource, 'customers');
  assert.equal(s.nodes.find((n) => n.id === 'source')!.config.connectorId, undefined, 'original unchanged');
});

test('connectNodes: idempotent, no self-edge', () => {
  const s = defaultDag();
  const same = connectNodes(s, 'source', 'destination'); // already exists in defaultDag
  assert.equal(same.edges.length, s.edges.length);
  const self = connectNodes(s, 'source', 'source');
  assert.equal(self.edges.length, s.edges.length);
});

test('disconnectNodes: removes exactly the edge', () => {
  const s = defaultDag();
  const cut = disconnectNodes(s, 'source', 'destination');
  assert.equal(cut.edges.length, 0);
});

test('moveNode + relabelNode: update position/label immutably', () => {
  const s = defaultDag();
  const moved = moveNode(s, 'source', { x: 5, y: 9 });
  assert.deepEqual(moved.nodes.find((n) => n.id === 'source')!.position, { x: 5, y: 9 });
  const relabeled = relabelNode(s, 'source', 'My source');
  assert.equal(relabeled.nodes.find((n) => n.id === 'source')!.label, 'My source');
});

test('setTrigger: schedule keeps cron, manual clears it', () => {
  const s = defaultDag();
  const sched = setTrigger(s, 'schedule', '0 2 * * *');
  assert.equal(sched.trigger, 'schedule');
  assert.equal(sched.cron, '0 2 * * *');
  const man = setTrigger(sched, 'manual');
  assert.equal(man.trigger, 'manual');
  assert.equal(man.cron, undefined);
});

test('a builder-authored DAG becomes valid once source + destination are configured', () => {
  let s = defaultDag();
  assert.equal(validateDagSpec(s).ok, false);
  s = updateNodeConfig(s, 'source', { connectorId: 'c1', resource: 'customers' });
  s = updateNodeConfig(s, 'destination', { database: 'analytics', table: 'customers' });
  assert.equal(validateDagSpec(s).ok, true, validateDagSpec(s).errors.join(' | '));
});
