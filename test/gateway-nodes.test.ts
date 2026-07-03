import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mapAggregatorNode,
  nodeActionSupport,
  validateNodeAction,
  type AggregatorNode,
  type NodeView,
} from '../src/lib/gateway.ts';

// ── mapAggregatorNode ─────────────────────────────────────────────────────────

test('maps a healthy aggregator node to the UI view shape', () => {
  const raw: AggregatorNode = {
    name: 'g1',
    host: 'offgrid-g1.local',
    port: 7878,
    model: 'qwythos-9b',
    vision: true,
    health: 'up',
    installedModels: [{ id: 'qwythos-9b' }, { id: 'gemma-4-e4b' }],
  };
  const v = mapAggregatorNode(raw);
  assert.deepEqual(v.installed, ['qwythos-9b', 'gemma-4-e4b']);
  assert.equal(v.activeModel, 'qwythos-9b');
  assert.equal(v.reachable, true);
  assert.equal(v.enabled, true);
  assert.equal(v.vision, true);
});

test('defaults port, coerces unknown health, tolerates missing installedModels', () => {
  const v = mapAggregatorNode({ name: 'g9', host: 'h', model: 'm' });
  assert.equal(v.port, 7878);
  assert.equal(v.health, 'unknown');
  assert.equal(v.reachable, false); // unknown ⇒ not reachable
  assert.deepEqual(v.installed, []);
});

test('down node is listed but not reachable', () => {
  const v = mapAggregatorNode({ name: 'g3', host: 'h', model: 'm', health: 'down' });
  assert.equal(v.health, 'down');
  assert.equal(v.reachable, false);
});

test('installed model ids drop non-string / empty entries', () => {
  const v = mapAggregatorNode({
    name: 'g',
    host: 'h',
    model: 'm',
    installedModels: [{ id: 'a' }, { id: '' }, { id: undefined as unknown as string }, { id: 'b' }],
  });
  assert.deepEqual(v.installed, ['a', 'b']);
});

// ── nodeActionSupport (honesty gate) ───────────────────────────────────────────

test('no node action has a real backend against the current aggregator', () => {
  for (const a of ['model', 'restart', 'enable', 'disable'] as const) {
    assert.equal(nodeActionSupport(a).backed, false, `${a} must be surfaced as blocked, not faked`);
    assert.ok(nodeActionSupport(a).needs.length > 0, `${a} must explain what it needs`);
  }
});

// ── validateNodeAction ─────────────────────────────────────────────────────────

const base: NodeView = {
  name: 'g1',
  host: 'offgrid-g1.local',
  port: 7878,
  model: 'gemma-4-e4b',
  vision: true,
  health: 'up',
  reachable: true,
  enabled: true,
  activeModel: 'gemma-4-e4b',
  installed: ['gemma-4-e4b', 'qwythos-9b'],
};

test('model swap: rejects empty target', () => {
  const r = validateNodeAction(base, { action: 'model', model: '  ' });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /required/);
});

test('model swap: rejects a model not installed on the node', () => {
  const r = validateNodeAction(base, { action: 'model', model: 'llama-70b' });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /not installed/);
});

test('model swap: rejects a no-op (already active)', () => {
  const r = validateNodeAction(base, { action: 'model', model: 'gemma-4-e4b' });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /already serves/);
});

test('model swap: a valid installed target is blocked (no backend) — not faked', () => {
  const r = validateNodeAction(base, { action: 'model', model: 'qwythos-9b' });
  assert.equal(r.ok, false);
  assert.equal((r as { blocked?: boolean }).blocked, true);
});

test('restart: blocked with an explanation, never ok', () => {
  const r = validateNodeAction(base, { action: 'restart' });
  assert.equal(r.ok, false);
  assert.equal((r as { blocked?: boolean }).blocked, true);
  assert.match((r as { reason: string }).reason, /host\/process control|Restart needs/);
});

test('disable: no-op when already disabled short-circuits before the block gate', () => {
  const disabled = { ...base, enabled: false };
  const r = validateNodeAction(disabled, { action: 'disable' });
  assert.equal(r.ok, false);
  assert.equal((r as { blocked?: boolean }).blocked, undefined);
  assert.match((r as { reason: string }).reason, /already disabled/);
});

test('enable: a real state change is blocked (no backend)', () => {
  const disabled = { ...base, enabled: false };
  const r = validateNodeAction(disabled, { action: 'enable' });
  assert.equal(r.ok, false);
  assert.equal((r as { blocked?: boolean }).blocked, true);
});
