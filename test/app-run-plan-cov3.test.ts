import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '../src/lib/app-model.ts';
import {
  entryStepId,
  deriveRunStatus,
  applyStepResult,
  initState,
  completedStepIds,
  type StepState,
} from '../src/lib/app-run-plan.ts';

function spec(over: Partial<AppSpec> = {}): AppSpec {
  return {
    id: 'a', orgId: 'default', ownerId: 'u', title: 't', summary: '', visibility: 'private',
    published: false, trigger: { kind: 'on-demand' },
    steps: [
      { id: 's1', label: 'a', kind: 'agent', agentId: 'x' },
      { id: 's2', label: 'b', kind: 'output', sink: 'console' },
    ],
    edges: [{ from: 's1', to: 's2' }],
    ...over,
  };
}

test('entryStepId: null on empty spec, the true entry otherwise, and first-step fallback on a cyclic graph', () => {
  assert.equal(entryStepId(spec({ steps: [], edges: [] })), null);
  assert.equal(entryStepId(spec()), 's1');
  // Degenerate: every step has an incoming edge (no entry) → fall back to first declared step.
  const cyc = spec({ edges: [{ from: 's1', to: 's2' }, { from: 's2', to: 's1' }] });
  assert.equal(entryStepId(cyc), 's1');
});

function ss(status: StepState['status'], id = 'x'): StepState {
  return { id, kind: 'agent', label: id, status };
}

test('deriveRunStatus precedence covers every arm', () => {
  assert.equal(deriveRunStatus([ss('error'), ss('done')]), 'error');
  assert.equal(deriveRunStatus([ss('awaiting_human'), ss('done')]), 'awaiting_human');
  assert.equal(deriveRunStatus([ss('done'), ss('skipped')]), 'done');
  // any running/done but not all done → running (the 184 arm)
  assert.equal(deriveRunStatus([ss('running'), ss('queued')]), 'running');
  assert.equal(deriveRunStatus([ss('done'), ss('queued')]), 'running');
  // none started → queued
  assert.equal(deriveRunStatus([ss('queued'), ss('queued')]), 'queued');
});

test('applyStepResult: running sets startedAt; done/error set startedAt+finishedAt; unknown id untouched', () => {
  const st = initState(spec(), 'run1');
  const running = applyStepResult(st, 's1', { status: 'running' }, '2026-01-01T00:00:00Z');
  const s1r = running.steps.find((s) => s.id === 's1')!;
  assert.equal(s1r.status, 'running');
  assert.equal(s1r.startedAt, '2026-01-01T00:00:00Z');
  assert.equal(running.status, 'running');

  // done on a step that never had startedAt → both timestamps get set
  const done = applyStepResult(st, 's2', { status: 'done', output: 'ok', refs: [{ name: 'r' }], detail: 'd', childRunId: 'c' }, '2026-01-02T00:00:00Z');
  const s2d = done.steps.find((s) => s.id === 's2')!;
  assert.equal(s2d.status, 'done');
  assert.equal(s2d.startedAt, '2026-01-02T00:00:00Z');
  assert.equal(s2d.finishedAt, '2026-01-02T00:00:00Z');
  assert.equal(s2d.output, 'ok');
  assert.equal(s2d.childRunId, 'c');

  // an unknown step id leaves all steps as-is
  const same = applyStepResult(st, 'ghost', { status: 'done' });
  assert.deepEqual(same.steps.map((s) => s.status), st.steps.map((s) => s.status));
});

test('applyStepResult: running on a step that already started keeps the original startedAt', () => {
  let st = initState(spec(), 'r');
  st = applyStepResult(st, 's1', { status: 'running' }, '2026-01-01T00:00:00Z');
  const again = applyStepResult(st, 's1', { status: 'running' }, '2026-06-01T00:00:00Z');
  assert.equal(again.steps.find((s) => s.id === 's1')!.startedAt, '2026-01-01T00:00:00Z');
});

test('completedStepIds counts done + skipped only', () => {
  const st = initState(spec(), 'r');
  const withStatus = {
    ...st,
    steps: [ss('done', 's1'), ss('awaiting_human', 's2'), ss('skipped', 's3')],
  };
  assert.deepEqual(completedStepIds(withStatus).sort(), ['s1', 's3']);
});
